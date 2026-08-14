import { PrivyClient } from '@privy-io/node'
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Encoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import { escrowConfiguration } from './escrow.js'

const LAMPORTS_PER_SOL = 1_000_000_000
const MAX_PAYOUT_LAMPORTS = 20 * LAMPORTS_PER_SOL
const NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const PLATFORM_FEE_TREASURY = 'HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN'

function settlementError(message, status = 503) {
  const error = new Error(message)
  error.status = status
  error.code = 'SETTLEMENT_NOT_CONFIGURED'
  return error
}

function config() {
  if (process.env.BATTLE_SETTLEMENT_MODE !== 'treasury') throw settlementError('Treasury settlement is not enabled.')
  const escrow = escrowConfiguration()
  const feeTreasury = PLATFORM_FEE_TREASURY
  const walletId = process.env.ESCROW_TREASURY_WALLET_ID
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  const authorizationPrivateKey = process.env.PRIVY_TREASURY_AUTHORIZATION_KEY
  if (!feeTreasury || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(feeTreasury)) throw settlementError('The platform fee wallet is not configured.')
  if (!walletId || !appId || !appSecret || !authorizationPrivateKey) throw settlementError('The Privy treasury signer is not configured.')
  return { ...escrow, feeTreasury, walletId, appId, appSecret, authorizationPrivateKey }
}

async function buildTransferTransaction({ rpc, source, payouts }) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const sourceSigner = createNoopSigner(address(source))
  const instructions = payouts.map((payout) => getTransferSolInstruction({
    source: sourceSigner,
    destination: address(payout.wallet),
    amount: BigInt(payout.amount),
  }))
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(address(source), value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(blockhash, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  )
  return Buffer.from(getTransactionEncoder().encode(compileTransaction(message))).toString('base64')
}

function signatureFrom(result) {
  const value = result?.hash ?? result?.signature ?? result?.data?.hash ?? result?.data?.signature
  if (typeof value === 'string' && value) return value
  if (value instanceof Uint8Array) return getBase58Encoder().encode(value)
  throw new Error('Privy did not return a Solana transaction signature.')
}

async function signAndSend({ privy, walletId, transaction, referenceId, authorizationPrivateKey }) {
  const result = await privy.wallets().solana().signAndSendTransaction(walletId, {
    caip2: NETWORK,
    transaction,
    reference_id: referenceId,
    idempotency_key: referenceId,
    authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
  })
  return signatureFrom(result)
}

function winnerWallet(battle) {
  if (battle.winner_mint === battle.token_a_mint) return battle.creator_wallet
  if (battle.winner_mint === battle.token_b_mint) return battle.opponent_wallet
  throw new Error('Battle winner is not available for settlement.')
}

function payoutFor(battle) {
  const pot = Number(battle.pot_lamports)
  const feeBps = Number(battle.fee_bps)
  const fee = Math.floor((pot * feeBps) / 10_000)
  const prize = pot - fee
  if (!Number.isSafeInteger(pot) || !Number.isSafeInteger(fee) || !Number.isSafeInteger(prize) || prize <= 0 || pot > MAX_PAYOUT_LAMPORTS) {
    throw new Error('This battle exceeds the configured automatic-payout limit.')
  }
  return { pot, fee, prize, winner: winnerWallet(battle) }
}

async function hasTreasuryBalance(rpc, treasury, requiredLamports) {
  const { value: balance } = await rpc.getBalance(address(treasury), { commitment: 'confirmed' }).send()
  // Keep a tiny margin for the network fee paid by the treasury wallet.
  return Number(balance) >= requiredLamports + 20_000
}

async function reconcileSubmitted(supabase, rpc, network) {
  const { data: pending, error } = await supabase.from('battles')
    .select('id,settlement_signature,settlement_reference_id')
    .eq('network', network)
    .eq('escrow_state', 'payment_submitted')
    .not('settlement_signature', 'is', null)
    .limit(25)
  if (error) throw error

  const completed = []
  for (const battle of pending ?? []) {
    const signature = battle.settlement_signature
    const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value[0]
    if (!status) continue
    if (status.err) {
      await supabase.from('battles').update({ escrow_state: 'review_required', escrow_error: 'settlement_transaction_failed', updated_at: new Date().toISOString() })
        .eq('id', battle.id).eq('escrow_state', 'payment_submitted')
      continue
    }
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      const settledAt = new Date().toISOString()
      const { error: battleError } = await supabase.from('battles').update({
        status: 'settled', escrow_state: 'settled', escrow_error: null, updated_at: settledAt,
      }).eq('id', battle.id).eq('escrow_state', 'payment_submitted').eq('settlement_signature', signature)
      if (battleError) throw battleError
      const { error: receiptError } = await supabase.from('platform_fee_receipts').update({ status: 'settled', settled_at: settledAt })
        .eq('battle_id', battle.id).eq('settlement_signature', signature)
      if (receiptError) throw receiptError
      completed.push({ id: battle.id, signature })
    }
  }
  return completed
}

export async function settleFinishedBattles(supabase, limit = 1, network = 'mainnet') {
  const settlement = config()
  const rpc = createSolanaRpc(settlement.rpcUrl)
  const reconciled = await reconcileSubmitted(supabase, rpc, network)
  const { data: battles, error } = await supabase.from('battles')
    .select('*')
    .eq('network', network)
    .eq('status', 'finished')
    .eq('escrow_state', 'funded')
    .is('settlement_signature', null)
    .order('ends_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const privy = new PrivyClient({ appId: settlement.appId, appSecret: settlement.appSecret })
  const submitted = []
  for (const battle of battles ?? []) {
    const referenceId = `battle-${battle.id}-settlement`
    const { data: claimed, error: claimError } = await supabase.from('battles').update({
      escrow_state: 'payment_pending', settlement_reference_id: referenceId, escrow_error: null, updated_at: new Date().toISOString(),
    }).eq('id', battle.id).eq('status', 'finished').eq('escrow_state', 'funded').is('settlement_signature', null).select('*').maybeSingle()
    if (claimError) throw claimError
    if (!claimed) continue

    try {
      const payout = payoutFor(claimed)
      if (!await hasTreasuryBalance(rpc, settlement.treasury, payout.pot)) throw new Error('The treasury does not have enough finalized SOL to pay this battle.')
      const transaction = await buildTransferTransaction({
        rpc,
        source: settlement.treasury,
        payouts: [{ wallet: payout.winner, amount: payout.prize }, { wallet: settlement.feeTreasury, amount: payout.fee }],
      })
      const { error: receiptError } = await supabase.from('platform_fee_receipts').upsert({
        battle_id: claimed.id, fee_lamports: payout.fee, fee_wallet: settlement.feeTreasury,
        settlement_signature: referenceId, status: 'pending',
      }, { onConflict: 'battle_id' })
      if (receiptError) throw receiptError
      const signature = await signAndSend({
        privy, walletId: settlement.walletId, transaction, referenceId,
        authorizationPrivateKey: settlement.authorizationPrivateKey,
      })
      const submittedAt = new Date().toISOString()
      const { error: updateError } = await supabase.from('battles').update({
        escrow_state: 'payment_submitted', settlement_signature: signature, settlement_submitted_at: submittedAt,
        payout_lamports: payout.prize, updated_at: submittedAt,
      }).eq('id', claimed.id).eq('escrow_state', 'payment_pending').eq('settlement_reference_id', referenceId)
      if (updateError) throw updateError
      const { error: receiptUpdateError } = await supabase.from('platform_fee_receipts').update({ settlement_signature: signature })
        .eq('battle_id', claimed.id).eq('settlement_signature', referenceId)
      if (receiptUpdateError) throw receiptUpdateError
      submitted.push({ id: claimed.id, signature, referenceId })
    } catch (error) {
      console.error('Treasury settlement failed', { battleId: claimed.id, error })
      await supabase.from('battles').update({
        escrow_state: 'review_required', escrow_error: 'settlement_requires_review', updated_at: new Date().toISOString(),
      }).eq('id', claimed.id).eq('escrow_state', 'payment_pending').eq('settlement_reference_id', referenceId)
      submitted.push({ id: claimed.id, error: 'settlement_requires_review' })
    }
  }
  return [...reconciled, ...submitted]
}

export const settlementLimitLamports = MAX_PAYOUT_LAMPORTS
