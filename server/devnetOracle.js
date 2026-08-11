import { createHash } from 'node:crypto'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { getPumpFunToken } from './pumpfun.js'

function oracleError(message) {
  const error = new Error(message)
  error.code = 'DEVNET_ORACLE_NOT_CONFIGURED'
  return error
}

function oracleConfig() {
  const secret = process.env.ORACLE_SETTLEMENT_AUTHORITY_SECRET
  const programId = process.env.ESCROW_PROGRAM_ID
  if (!secret || !programId) throw oracleError('Devnet oracle signing is not configured.')
  let authority
  try {
    authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)))
  } catch {
    throw oracleError('Devnet oracle signing key is invalid.')
  }
  return {
    authority,
    programId: new PublicKey(programId),
    connection: new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed'),
  }
}

function discriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

function roundedChange(current, initial) {
  const start = Number(initial)
  if (!Number.isFinite(current) || !Number.isFinite(start) || start <= 0) throw new Error('Oracle price data is unavailable for this battle.')
  return Number((((current - start) / start) * 100).toFixed(4))
}

function winnerFor(battle, changeA, changeB) {
  return changeA > changeB
    ? { mint: battle.token_a_mint, symbol: battle.token_a_symbol, wallet: battle.creator_wallet }
    : { mint: battle.token_b_mint, symbol: battle.token_b_symbol, wallet: battle.opponent_wallet }
}

async function fetchOutcome(battle) {
  const [tokenA, tokenB] = await Promise.all([
    getPumpFunToken(battle.token_a_mint),
    getPumpFunToken(battle.token_b_mint),
  ])
  const changeA = roundedChange(tokenA.marketCap, battle.token_a_market_cap)
  const changeB = roundedChange(tokenB.marketCap, battle.token_b_market_cap)
  return { tokenA, tokenB, changeA, changeB, winner: winnerFor(battle, changeA, changeB) }
}

async function readOnchainBattle({ connection, programId, battle }) {
  const address = new PublicKey(battle.onchain_battle_address)
  const account = await connection.getAccountInfo(address, 'confirmed')
  if (!account || !account.owner.equals(programId) || account.data.length < 249) {
    throw new Error('The Devnet escrow account cannot be verified.')
  }

  const data = account.data
  const pubkeyAt = (offset) => new PublicKey(data.subarray(offset, offset + 32)).toBase58()
  const stakeLamports = Number(data.readBigUInt64LE(152))
  const details = {
    creator: pubkeyAt(24),
    opponent: pubkeyAt(56),
    tokenAMint: pubkeyAt(88),
    tokenBMint: pubkeyAt(120),
    stakeLamports,
    endsAt: Number(data.readBigInt64LE(172)),
    status: data[180],
    feeBps: data.readUInt16LE(181),
    feeTreasury: pubkeyAt(183),
    settlementAuthority: pubkeyAt(215),
  }
  if (
    details.status !== 1 ||
    details.creator !== battle.creator_wallet ||
    details.opponent !== battle.opponent_wallet ||
    details.tokenAMint !== battle.token_a_mint ||
    details.tokenBMint !== battle.token_b_mint ||
    details.stakeLamports !== Number(battle.stake_lamports)
  ) {
    throw new Error('The Devnet escrow state does not match the battle record.')
  }
  return details
}

async function settleOnchain({ battle, winner, settlement, connection, programId, authority }) {
  if (settlement.settlementAuthority !== authority.publicKey.toBase58()) {
    throw oracleError('The Devnet oracle is not the authorized settlement signer.')
  }
  const instruction = new TransactionInstruction({
    programId,
    data: discriminator('settle_battle'),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(winner.wallet), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(settlement.feeTreasury), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(battle.onchain_battle_address), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(battle.vault_address), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(battle.creator_wallet), isSigner: false, isWritable: true },
    ],
  })
  const transaction = new Transaction().add(instruction)
  transaction.feePayer = authority.publicKey
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  const signature = await connection.sendTransaction(transaction, [authority], { skipPreflight: false, preflightCommitment: 'confirmed' })
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) throw new Error('Devnet oracle settlement was rejected on-chain.')
  return signature
}

async function reconcilePendingSettlements({ supabase, connection, programId }) {
  const { data: pending, error } = await supabase.from('battles')
    .select('id,onchain_battle_address,settlement_signature')
    .eq('network', 'devnet')
    .eq('status', 'active')
    .like('settlement_signature', 'oracle-pending:%')
  if (error) throw error

  for (const battle of pending ?? []) {
    const account = await connection.getAccountInfo(new PublicKey(battle.onchain_battle_address), 'confirmed')
    if (account) continue
    const signatures = await connection.getSignaturesForAddress(new PublicKey(battle.onchain_battle_address), { limit: 10 }, 'confirmed')
    const signature = signatures.find((entry) => !entry.err)?.signature ?? battle.settlement_signature
    const settledAt = new Date().toISOString()
    const { error: battleError } = await supabase.from('battles').update({
      status: 'settled', escrow_state: 'settled', settlement_signature: signature, escrow_error: null, updated_at: settledAt,
    }).eq('id', battle.id).eq('settlement_signature', battle.settlement_signature)
    if (battleError) throw battleError
    const { error: receiptError } = await supabase.from('platform_fee_receipts').update({
      settlement_signature: signature, status: 'settled', settled_at: settledAt,
    }).eq('battle_id', battle.id)
    if (receiptError) throw receiptError
  }
}

export async function settleDevnetBattles(supabase, limit = 25) {
  const { connection, programId, authority } = oracleConfig()
  await reconcilePendingSettlements({ supabase, connection, programId })
  const now = new Date().toISOString()
  const { data: battles, error } = await supabase.from('battles')
    .select('*')
    .eq('network', 'devnet')
    .eq('status', 'active')
    .eq('escrow_state', 'funded')
    .is('settlement_signature', null)
    .lte('ends_at', now)
    .order('ends_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const results = []
  for (const battle of battles ?? []) {
    let onchainSignature
    try {
      const settlement = await readOnchainBattle({ battle, connection, programId })
      if (settlement.endsAt > Math.floor(Date.now() / 1000)) continue
      const outcome = await fetchOutcome(battle)
      const claim = `oracle-pending:${battle.id}`
      const { data: claimed, error: claimError } = await supabase.from('battles').update({
        settlement_signature: claim,
        winner_mint: outcome.winner.mint,
        winner_symbol: outcome.winner.symbol,
        token_a_change_pct: outcome.changeA,
        token_b_change_pct: outcome.changeB,
        escrow_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', battle.id).eq('status', 'active').eq('escrow_state', 'funded').is('settlement_signature', null).select('*').maybeSingle()
      if (claimError) throw claimError
      if (!claimed) continue

      const feeLamports = Math.floor((settlement.stakeLamports * 2) * settlement.feeBps / 10_000)
      const { error: snapshotError } = await supabase.from('battle_price_snapshots').insert({
        battle_id: claimed.id,
        token_a_price_usd: outcome.tokenA.priceUsd ?? 0,
        token_b_price_usd: outcome.tokenB.priceUsd ?? 0,
      })
      if (snapshotError) throw snapshotError
      const { error: receiptError } = await supabase.from('platform_fee_receipts').upsert({
        battle_id: claimed.id,
        fee_lamports: feeLamports,
        fee_wallet: settlement.feeTreasury,
        settlement_signature: claim,
        status: 'pending',
      }, { onConflict: 'battle_id' })
      if (receiptError) throw receiptError

      onchainSignature = await settleOnchain({ battle: claimed, winner: outcome.winner, settlement, connection, programId, authority })
      const settledAt = new Date().toISOString()
      const { error: settledError } = await supabase.from('battles').update({
        status: 'settled', escrow_state: 'settled', settlement_signature: onchainSignature, escrow_error: null, updated_at: settledAt,
      }).eq('id', claimed.id).eq('settlement_signature', claim)
      if (settledError) throw settledError
      const { error: receiptUpdateError } = await supabase.from('platform_fee_receipts').update({
        settlement_signature: onchainSignature, status: 'settled', settled_at: settledAt,
      }).eq('battle_id', claimed.id).eq('settlement_signature', claim)
      if (receiptUpdateError) throw receiptUpdateError
      results.push({ id: claimed.id, signature: onchainSignature, winner: outcome.winner.mint })
    } catch (error) {
      console.error('Devnet oracle settlement failed', { battleId: battle.id, error })
      if (onchainSignature) {
        const settledAt = new Date().toISOString()
        await supabase.from('battles').update({
          status: 'settled', escrow_state: 'settled', settlement_signature: onchainSignature, escrow_error: null, updated_at: settledAt,
        }).eq('id', battle.id).like('settlement_signature', 'oracle-pending:%')
        await supabase.from('platform_fee_receipts').update({
          settlement_signature: onchainSignature, status: 'settled', settled_at: settledAt,
        }).eq('battle_id', battle.id)
        results.push({ id: battle.id, signature: onchainSignature, recovered: true })
        continue
      }
      await supabase.from('battles').update({
        escrow_state: 'error', escrow_error: 'oracle_settlement_requires_review', updated_at: new Date().toISOString(),
      }).eq('id', battle.id).like('settlement_signature', 'oracle-pending:%')
      results.push({ id: battle.id, error: 'oracle_settlement_requires_review' })
    }
  }
  return results
}
