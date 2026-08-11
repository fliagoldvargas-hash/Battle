import { PrivyClient } from '@privy-io/node'
import { randomUUID } from 'node:crypto'
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import { escrowConfiguration } from './escrow.js'

function settlementError(message) {
  const error = new Error(message)
  error.status = 503
  error.code = 'SETTLEMENT_NOT_CONFIGURED'
  return error
}

function config() {
  const escrow = escrowConfiguration()
  const feeTreasury = process.env.ESCROW_FEE_TREASURY_ADDRESS
  if (!feeTreasury || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(feeTreasury)) {
    throw settlementError('Settlement is not configured: set ESCROW_FEE_TREASURY_ADDRESS to a Solana fee wallet.')
  }
  const walletId = process.env.ESCROW_TREASURY_WALLET_ID
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!walletId || !appId || !appSecret) {
    throw settlementError('Settlement is not configured: set ESCROW_TREASURY_WALLET_ID and Privy server credentials.')
  }
  return { ...escrow, feeTreasury, walletId, appId, appSecret }
}

async function buildPayoutTransaction({ rpc, source, payouts }) {
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

async function sendTransfer({ privy, walletId, transaction }) {
  const result = await privy.wallets().solana().signAndSendTransaction(walletId, {
    caip2: 'solana:mainnet',
    transaction,
  })
  return typeof result.signature === 'string'
    ? result.signature
    : Buffer.from(result.signature).toString('base64')
}

export async function settleFinishedBattles(supabase, limit = 25) {
  const settlement = config()
  const privy = new PrivyClient({ appId: settlement.appId, appSecret: settlement.appSecret })
  const rpc = createSolanaRpc(settlement.rpcUrl)
  const { data: battles, error } = await supabase
    .from('battles')
    .select('*')
    .eq('status', 'finished')
    .eq('escrow_state', 'funded')
    .is('settlement_signature', null)
    .limit(limit)
  if (error) {
    if (error.code === '42703') return []
    throw error
  }

  const results = []
  for (const battle of battles ?? []) {
    // Claim the battle before talking to the signing service. More than one
    // request can reach this worker at the same time (the public refresh,
    // Vercel Cron, or a retry); only the request that writes this opaque
    // marker is allowed to broadcast a payout transaction. This uses the
    // existing nullable signature field, so the protection is live without a
    // schema rollout.
    const claimToken = `pending:${randomUUID()}`
    const { data: claimedBattle, error: claimError } = await supabase
      .from('battles')
      .update({
        settlement_signature: claimToken,
        escrow_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', battle.id)
      .eq('status', 'finished')
      .eq('escrow_state', 'funded')
      .is('settlement_signature', null)
      .select('*')
      .maybeSingle()

    if (claimError) throw claimError
    if (!claimedBattle) continue

    try {
      const pot = Number(claimedBattle.pot_lamports)
      const fee = Math.floor(pot * 25 / 10_000)
      const winnerWallet = claimedBattle.winner_mint === claimedBattle.token_a_mint
        ? claimedBattle.creator_wallet
        : claimedBattle.winner_mint === claimedBattle.token_b_mint
          ? claimedBattle.opponent_wallet
          : null
      if (!winnerWallet) throw new Error('Battle winner is not available for settlement.')
      const payouts = [
        { wallet: winnerWallet, amount: pot - fee },
        { wallet: settlement.feeTreasury, amount: fee },
      ]
      for (const payout of payouts) {
        if (!payout.wallet || !Number.isSafeInteger(payout.amount) || payout.amount <= 0) throw new Error('Invalid battle payout.')
      }

      // Create the accounting entry before broadcasting. A later timeout can
      // never make a completed fee disappear from the internal ledger.
      const { error: receiptError } = await supabase.from('platform_fee_receipts').upsert({
        battle_id: claimedBattle.id,
        fee_lamports: fee,
        fee_wallet: settlement.feeTreasury,
        settlement_signature: claimToken,
        status: 'pending',
      }, { onConflict: 'battle_id' })
      if (receiptError) throw receiptError

      const transaction = await buildPayoutTransaction({ rpc, source: settlement.treasury, payouts })
      const signatures = [await sendTransfer({ privy, walletId: settlement.walletId, transaction })]
      const settledAt = new Date().toISOString()
      const { error: receiptUpdateError } = await supabase.from('platform_fee_receipts').update({
        settlement_signature: signatures.join(','),
        status: 'settled',
        settled_at: settledAt,
      }).eq('battle_id', claimedBattle.id).eq('settlement_signature', claimToken)
      if (receiptUpdateError) throw receiptUpdateError

      const { error: updateError } = await supabase.from('battles').update({
        settlement_signature: signatures.join(','),
        escrow_state: claimedBattle.winner_mint ? 'settled' : 'refunded',
        escrow_error: null,
        updated_at: settledAt,
      }).eq('id', claimedBattle.id).eq('status', 'finished').eq('settlement_signature', claimToken)
      if (updateError) throw updateError
      results.push({ id: claimedBattle.id, signatures })
    } catch (battleError) {
      console.error('Battle settlement failed', { battleId: claimedBattle.id, error: battleError })
      // Do not retry an ambiguous signing/broadcast failure automatically:
      // the transaction might already be on-chain even if the response was
      // lost. Keeping the claim token prevents a second payout and leaves an
      // explicit record for reconciliation.
      await supabase.from('battles').update({
        escrow_state: 'error',
        escrow_error: 'settlement_requires_review',
        updated_at: new Date().toISOString(),
      }).eq('id', claimedBattle.id).eq('settlement_signature', claimToken)
      results.push({ id: claimedBattle.id, error: 'settlement_requires_review' })
    }
  }
  return results
}
