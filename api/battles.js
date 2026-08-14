import { PrivyClient } from '@privy-io/node'
import { createClient } from '@supabase/supabase-js'
import { getPumpFunToken } from '../server/pumpfun.js'
import { verifyStakeTransfer } from '../server/escrow.js'
import { quoteFeeForWallet } from '../server/holderFees.js'

const LAMPORTS_PER_SOL = 1_000_000_000
// 0.013 SOL per player means a 0.026 SOL matched pot. It keeps the first
// Mainnet test close to US$2 while still using whole, exact lamport amounts.
const MIN_STAKE_LAMPORTS = 13_000_000
const MAX_STAKE_LAMPORTS = 10_000_000_000
const ALLOWED_DURATIONS = new Set([60, 1800, 3600, 7200, 14400, 28800, 86400])
const DEPOSIT_INTENT_TTL_MS = 10 * 60 * 1000
const SOLANA_MAINNET_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const send = (response, status, body) => response.status(status).json(body)
const battleNetwork = () => process.env.BATTLE_NETWORK === 'devnet' ? 'devnet' : 'mainnet'
const isTreasuryMode = () => process.env.BATTLE_SETTLEMENT_MODE === 'treasury'

function publicBattle(battle) {
  if (!battle) return battle
  const { creator_privy_user_id: _creatorPrivyUserId, opponent_privy_user_id: _opponentPrivyUserId, ...publicFields } = battle
  return publicFields
}

function readBearerToken(request) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length).trim() || null
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing server environment variable: ${name}`)
  return value
}

function createServerClients() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  if (!appId) throw new Error('Missing server environment variable: PRIVY_APP_ID')

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  if (!supabaseUrl) throw new Error('Missing server environment variable: SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')

  return {
    privy: new PrivyClient({ appId, appSecret: requiredEnvironment('PRIVY_APP_SECRET') }),
    supabase: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

async function authenticateRequest(request, privy) {
  const token = readBearerToken(request)
  if (!token) {
    const error = new Error('Sign in with Privy before changing a battle.')
    error.status = 401
    throw error
  }

  try {
    const claims = await privy.utils().auth().verifyAccessToken(token)
    const user = await privy.users()._get(claims.user_id)
    return { userId: claims.user_id, user }
  } catch {
    const error = new Error('Your Privy session could not be verified. Reconnect your wallet and try again.')
    error.status = 401
    throw error
  }
}

function verifiedSolanaWallet(user, walletAddress) {
  const account = user.linked_accounts?.find((linkedAccount) => (
    linkedAccount.type === 'wallet'
    && linkedAccount.chain_type === 'solana'
    && linkedAccount.address === walletAddress
  ))

  if (!account) {
    const error = new Error('The selected Solana wallet is not linked to this Privy account.')
    error.status = 403
    throw error
  }

  return account.address
}

function parseStakeLamports(stakeSol) {
  const stakeLamports = Math.round(Number(stakeSol) * LAMPORTS_PER_SOL)
  if (!Number.isSafeInteger(stakeLamports)
    || stakeLamports < MIN_STAKE_LAMPORTS
    || stakeLamports > MAX_STAKE_LAMPORTS) {
    const error = new Error('Stake must be between 0.013 and 10 SOL.')
    error.status = 400
    throw error
  }
  return stakeLamports
}

function assertCreatePayload(payload) {
  if (!payload?.token || !ALLOWED_DURATIONS.has(payload.durationSeconds)) {
    const error = new Error('Invalid token or battle duration.')
    error.status = 400
    throw error
  }
}

async function getRecentBlockhash() {
  let rpcResponse
  try {
    rpcResponse = await fetch(SOLANA_MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'battle-deposit-blockhash',
        method: 'getLatestBlockhash',
        params: [{ commitment: 'processed' }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    const error = new Error('Solana is temporarily unavailable. Please try again in a moment.')
    error.status = 503
    throw error
  }

  const payload = await rpcResponse.json().catch(() => null)
  const value = payload?.result?.value
  if (!rpcResponse.ok || payload?.error || typeof value?.blockhash !== 'string' || !Number.isSafeInteger(Number(value.lastValidBlockHeight))) {
    const error = new Error('Solana is temporarily unavailable. Please try again in a moment.')
    error.status = 503
    throw error
  }

  return {
    blockhash: value.blockhash,
    lastValidBlockHeight: Number(value.lastValidBlockHeight),
  }
}

async function assertPrepareRateLimit(supabase, walletAddress, action) {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count, error } = await supabase.from('battle_deposit_intents').select('id', { count: 'exact', head: true })
    .eq('wallet_address', walletAddress).eq('action', action).gte('created_at', since)
  if (error) throw error
  if ((count ?? 0) >= 5) {
    const limited = new Error('Too many deposit preparations. Wait one minute and try again.')
    limited.status = 429
    throw limited
  }
}

async function createDepositIntent({ supabase, userId, walletAddress, payload }) {
  const action = payload?.action
  const expiresAt = new Date(Date.now() + DEPOSIT_INTENT_TTL_MS).toISOString()
  if (action === 'prepare_create') {
    await assertPrepareRateLimit(supabase, walletAddress, 'create')
    assertCreatePayload(payload)
    const token = await getPumpFunToken(payload.token.mint)
    const stakeLamports = parseStakeLamports(payload.stakeSol)
    const feeQuote = await quoteFeeForWallet(supabase, walletAddress)
    const { data, error } = await supabase.from('battle_deposit_intents').insert({
      network: battleNetwork(), action: 'create', privy_user_id: userId, wallet_address: walletAddress,
      token_mint: token.mint, token_symbol: token.symbol, token_market_cap: token.marketCap,
      stake_lamports: stakeLamports, duration_seconds: payload.durationSeconds, fee_bps: feeQuote.feeBps,
      expires_at: expiresAt,
    }).select('*').single()
    if (error) throw error
    return { intent: data, feeBps: feeQuote.feeBps }
  }

  if (action === 'prepare_join') {
    await assertPrepareRateLimit(supabase, walletAddress, 'join')
    if (typeof payload?.battleId !== 'string') {
      const error = new Error('Invalid battle.')
      error.status = 400
      throw error
    }
    const { data: battle, error: battleError } = await supabase.from('battles').select('*')
      .eq('id', payload.battleId).eq('network', battleNetwork()).eq('status', 'waiting')
      .eq('escrow_state', 'awaiting_deposits').is('opponent_wallet', null).maybeSingle()
    if (battleError) throw battleError
    if (!battle) {
      const error = new Error('This battle is no longer available to join.')
      error.status = 409
      throw error
    }
    if (battle.creator_privy_user_id === userId || battle.creator_wallet === walletAddress) {
      const error = new Error('You cannot join your own battle.')
      error.status = 400
      throw error
    }
    // Reserve the only opponent seat before the browser asks the user to transfer.
    // A plain read followed by a transfer would let two players fund the same battle.
    await supabase.from('battles').update({
      join_reservation_token: null, join_reservation_wallet: null, join_reservation_expires_at: null,
    }).eq('id', battle.id).lt('join_reservation_expires_at', new Date().toISOString())

    const { data, error } = await supabase.from('battle_deposit_intents').insert({
      network: battleNetwork(), action: 'join', battle_id: battle.id, privy_user_id: userId,
      wallet_address: walletAddress, stake_lamports: battle.stake_lamports, expires_at: expiresAt,
    }).select('*').single()
    if (error) throw error

    const { data: reserved, error: reservationError } = await supabase.from('battles').update({
      join_reservation_token: data.id,
      join_reservation_wallet: walletAddress,
      join_reservation_expires_at: expiresAt,
    }).eq('id', battle.id).eq('status', 'waiting').eq('escrow_state', 'awaiting_deposits')
      .is('opponent_wallet', null).is('join_reservation_token', null).select('*').maybeSingle()
    if (reservationError) throw reservationError
    if (!reserved) {
      const unavailable = new Error('Another player is already preparing to join this battle. No transfer was requested.')
      unavailable.status = 409
      throw unavailable
    }
    return { intent: data, feeBps: Number(reserved.fee_bps) }
  }

  const error = new Error('Unsupported deposit intent.')
  error.status = 400
  throw error
}

async function loadDepositIntent(supabase, userId, walletAddress, intentId, action) {
  if (typeof intentId !== 'string') {
    const error = new Error('Prepare the treasury deposit before signing it.')
    error.status = 400
    throw error
  }
  const { data: intent, error } = await supabase.from('battle_deposit_intents').select('*')
    .eq('id', intentId).eq('network', battleNetwork()).eq('action', action)
    .eq('privy_user_id', userId).eq('wallet_address', walletAddress).maybeSingle()
  if (error) throw error
  if (!intent || new Date(intent.expires_at).getTime() < Date.now()) {
    const expired = new Error('This deposit request expired. Prepare a new one before sending SOL.')
    expired.status = 409
    throw expired
  }
  return intent
}

async function refreshDepositBlockhash({ supabase, userId, walletAddress, intentId }) {
  if (typeof intentId !== 'string') {
    const error = new Error('Prepare the treasury deposit before requesting a fresh approval.')
    error.status = 400
    throw error
  }
  const { data: intent, error } = await supabase.from('battle_deposit_intents').select('*')
    .eq('id', intentId).eq('network', battleNetwork()).eq('privy_user_id', userId).eq('wallet_address', walletAddress).maybeSingle()
  if (error) throw error
  if (!intent || new Date(intent.expires_at).getTime() < Date.now()) {
    const expired = new Error('This deposit request expired. Prepare a new battle before signing.')
    expired.status = 409
    throw expired
  }
  return intent
}

async function confirmCreateDeposit({ supabase, userId, walletAddress, payload }) {
  const intent = await loadDepositIntent(supabase, userId, walletAddress, payload?.depositIntentId, 'create')
  if (intent.deposit_signature) {
    const { data: existing } = await supabase.from('battles').select('*').eq('creator_deposit_signature', intent.deposit_signature).maybeSingle()
    if (existing) return existing
  }
  const deposit = await verifyStakeTransfer({
    signature: payload?.depositSignature, walletAddress, expectedLamports: Number(intent.stake_lamports),
    lastValidBlockHeight: payload?.lastValidBlockHeight,
  })
  await assertDepositIsUnused(supabase, deposit.signature)
  const { data, error } = await supabase.from('battles').insert({
    network: battleNetwork(), creator_privy_user_id: userId, creator_wallet: walletAddress,
    token_a_mint: intent.token_mint, token_a_symbol: intent.token_symbol, token_a_market_cap: intent.token_market_cap,
    token_a_change_pct: 0, stake_lamports: intent.stake_lamports, pot_lamports: intent.stake_lamports,
    duration_seconds: intent.duration_seconds, fee_bps: intent.fee_bps, escrow_state: 'awaiting_deposits',
    escrow_account: deposit.treasury, escrow_program_id: deposit.programId, creator_deposit_signature: deposit.signature,
  }).select('*').single()
  if (error) throw error
  await supabase.from('battle_deposit_intents').update({ deposit_signature: deposit.signature, consumed_at: new Date().toISOString() }).eq('id', intent.id)
  return data
}

async function confirmJoinDeposit({ supabase, userId, walletAddress, payload }) {
  const intent = await loadDepositIntent(supabase, userId, walletAddress, payload?.depositIntentId, 'join')
  if (intent.deposit_signature) {
    const { data: existing } = await supabase.from('battles').select('*').eq('opponent_deposit_signature', intent.deposit_signature).maybeSingle()
    if (existing) return existing
  }
  const token = await getPumpFunToken(payload?.token?.mint)
  const { data: battle, error: battleError } = await supabase.from('battles').select('*').eq('id', intent.battle_id).maybeSingle()
  if (battleError) throw battleError
  if (!battle || battle.status !== 'waiting' || battle.escrow_state !== 'awaiting_deposits' || battle.opponent_wallet
    || battle.join_reservation_token !== intent.id || battle.join_reservation_wallet !== walletAddress) {
    const unavailable = new Error('This battle is no longer available to join. No second transfer was requested.')
    unavailable.status = 409
    throw unavailable
  }
  const deposit = await verifyStakeTransfer({
    signature: payload?.depositSignature, walletAddress, expectedLamports: Number(intent.stake_lamports),
    lastValidBlockHeight: payload?.lastValidBlockHeight,
  })
  await assertDepositIsUnused(supabase, deposit.signature)
  const now = new Date()
  const { data, error } = await supabase.from('battles').update({
    status: 'active', opponent_privy_user_id: userId, opponent_wallet: walletAddress,
    token_b_mint: token.mint, token_b_symbol: token.symbol, token_b_market_cap: token.marketCap, token_b_change_pct: 0,
    pot_lamports: Number(battle.stake_lamports) * 2, starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + battle.duration_seconds * 1000).toISOString(), updated_at: now.toISOString(),
    escrow_state: 'funded', escrow_account: deposit.treasury, escrow_program_id: deposit.programId,
    opponent_deposit_signature: deposit.signature,
    join_reservation_token: null, join_reservation_wallet: null, join_reservation_expires_at: null,
  }).eq('id', battle.id).eq('status', 'waiting').eq('escrow_state', 'awaiting_deposits').is('opponent_wallet', null)
    .eq('join_reservation_token', intent.id).eq('join_reservation_wallet', walletAddress).select('*').maybeSingle()
  if (error) throw error
  if (!data) {
    const conflict = new Error('This battle was just joined by someone else. Your deposit remains verifiable for review.')
    conflict.status = 409
    throw conflict
  }
  await supabase.from('battle_deposit_intents').update({ deposit_signature: deposit.signature, consumed_at: now.toISOString() }).eq('id', intent.id)
  return data
}

async function assertDepositIsUnused(supabase, signature) {
  if (!signature) return
  const { data, error } = await supabase
    .from('battles')
    .select('id')
    .or(`creator_deposit_signature.eq.${signature},opponent_deposit_signature.eq.${signature}`)
    .limit(1)
  if (error) throw error
  if (data?.length) {
    const replayError = new Error('This Solana deposit has already been used for another battle.')
    replayError.status = 409
    throw replayError
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    try {
      const { supabase } = createServerClients()
      const network = battleNetwork()
      // A public read must never advance a battle or send funds. The authenticated
      // scheduler is the only path allowed to settle a treasury battle.
      const processed = []
      const settlements = []
      const { data: battles, error } = await supabase
        .from('battles')
        .select('*')
        .eq('network', network)
        .in('status', ['waiting', 'active', 'finished', 'settled'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return send(response, 200, { battles: battles.map(publicBattle), processed, settlements })
    } catch (error) {
      console.error('Battle read API error', error)
      return send(response, 500, { error: 'Unable to load battles right now.' })
    }
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return send(response, 405, { error: 'Method not allowed.' })
  }

  try {
    if (!isTreasuryMode()) {
      return send(response, 409, { error: 'This deployment is not configured for the treasury battle flow.' })
    }
    const { privy, supabase } = createServerClients()
    const identity = await authenticateRequest(request, privy)
    const walletAddress = verifiedSolanaWallet(identity.user, request.body?.walletAddress)

    if (request.body?.action === 'prepare_create' || request.body?.action === 'prepare_join') {
      // Do this server-side: browser calls to a public Solana RPC regularly
      // fail before a connected external wallet has a chance to show its prompt.
      const recentBlockhash = await getRecentBlockhash()
      const prepared = await createDepositIntent({ supabase, userId: identity.userId, walletAddress, payload: request.body })
      return send(response, 200, {
        depositIntentId: prepared.intent.id,
        stakeLamports: Number(prepared.intent.stake_lamports),
        feeBps: prepared.feeBps,
        expiresAt: prepared.intent.expires_at,
        recentBlockhash,
      })
    }

    if (request.body?.action === 'refresh_deposit_blockhash') {
      const intent = await refreshDepositBlockhash({
        supabase, userId: identity.userId, walletAddress, intentId: request.body?.depositIntentId,
      })
      return send(response, 200, {
        depositIntentId: intent.id,
        stakeLamports: Number(intent.stake_lamports),
        feeBps: Number(intent.fee_bps),
        expiresAt: intent.expires_at,
        recentBlockhash: await getRecentBlockhash(),
      })
    }

    let battle
    if (request.body?.action === 'confirm_create') {
      battle = await confirmCreateDeposit({ supabase, userId: identity.userId, walletAddress, payload: request.body })
    } else if (request.body?.action === 'confirm_join') {
      battle = await confirmJoinDeposit({ supabase, userId: identity.userId, walletAddress, payload: request.body })
    } else {
      return send(response, 400, { error: 'Unsupported battle action.' })
    }

    return send(response, 200, { battle: publicBattle(battle) })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Battle API error', error)
    return send(response, status, {
      error: status >= 500 ? 'Unable to update the battle right now.' : error.message,
      code: error.code,
    })
  }
}
