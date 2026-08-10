import { PrivyClient } from '@privy-io/node'
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
    try {
      const pot = Number(battle.pot_lamports)
      const fee = Math.floor(pot * 25 / 10_000)
      const winnerWallet = battle.winner_mint === battle.token_a_mint
        ? battle.creator_wallet
        : battle.winner_mint === battle.token_b_mint
          ? battle.opponent_wallet
          : null
      if (!winnerWallet) throw new Error('Battle winner is not available for settlement.')
      const payouts = [
        { wallet: winnerWallet, amount: pot - fee },
        { wallet: settlement.feeTreasury, amount: fee },
      ]
      for (const payout of payouts) {
        if (!payout.wallet || !Number.isSafeInteger(payout.amount) || payout.amount <= 0) throw new Error('Invalid battle payout.')
      }
      const transaction = await buildPayoutTransaction({ rpc, source: settlement.treasury, payouts })
      const signatures = [await sendTransfer({ privy, walletId: settlement.walletId, transaction })]
      const { error: updateError } = await supabase.from('battles').update({
        settlement_signature: signatures.join(','),
        escrow_state: battle.winner_mint ? 'settled' : 'refunded',
        escrow_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', battle.id).eq('status', 'finished')
      if (updateError) throw updateError
      results.push({ id: battle.id, signatures })
    } catch (battleError) {
      console.error('Battle settlement failed', { battleId: battle.id, error: battleError })
      await supabase.from('battles').update({ escrow_state: 'error', escrow_error: 'settlement_failed' }).eq('id', battle.id)
      results.push({ id: battle.id, error: 'settlement_failed' })
    }
  }
  return results
}
