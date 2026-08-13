import { PrivyClient } from '@privy-io/node'
import { createClient } from '@supabase/supabase-js'
import { getPumpFunToken } from '../server/pumpfun.js'
import { escrowConfiguration, verifyStakeTransfer } from '../server/escrow.js'
import { processActiveBattles } from '../server/processBattles.js'
import { settleFinishedBattles } from '../server/settlement.js'

const LAMPORTS_PER_SOL = 1_000_000_000
const MIN_STAKE_LAMPORTS = 100_000_000
const MAX_STAKE_LAMPORTS = 1_000_000_000_000
const ALLOWED_DURATIONS = new Set([1800, 3600, 7200, 14400, 28800, 86400])

const send = (response, status, body) => response.status(status).json(body)
const battleNetwork = () => process.env.BATTLE_NETWORK === 'devnet' ? 'devnet' : 'mainnet'

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
    const error = new Error('Stake must be between 0.1 and 1,000 SOL.')
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

async function createBattle({ supabase, userId, walletAddress, payload }) {
  assertCreatePayload(payload)
  const token = await getPumpFunToken(payload.token.mint)
  const stakeLamports = parseStakeLamports(payload.stakeSol)
  const deposit = await verifyOptionalDeposit({
    signature: payload.depositSignature,
    walletAddress,
    expectedLamports: stakeLamports,
  })
  await assertDepositIsUnused(supabase, deposit?.signature)

  const { data, error } = await supabase
    .from('battles')
    .insert({
      network: battleNetwork(),
      creator_privy_user_id: userId,
      creator_wallet: walletAddress,
      token_a_mint: token.mint,
      token_a_symbol: token.symbol,
      token_a_market_cap: token.marketCap,
      token_a_change_pct: 0,
      stake_lamports: stakeLamports,
      pot_lamports: stakeLamports,
      duration_seconds: payload.durationSeconds,
      ...(deposit ? {
        escrow_state: 'awaiting_deposits',
        escrow_account: deposit.treasury,
        escrow_program_id: deposit.programId,
        creator_deposit_signature: deposit.signature,
      } : {}),
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function joinBattle({ supabase, userId, walletAddress, payload }) {
  if (!payload?.token || typeof payload.battleId !== 'string') {
    const error = new Error('Invalid battle or token.')
    error.status = 400
    throw error
  }
  const token = await getPumpFunToken(payload.token.mint)

  const { data: existingBattle, error: readError } = await supabase
    .from('battles')
    .select('*')
    .eq('id', payload.battleId)
    .eq('network', battleNetwork())
    .maybeSingle()

  if (readError) throw readError
  if (!existingBattle) {
    const error = new Error('Battle not found.')
    error.status = 404
    throw error
  }
  if (existingBattle.creator_privy_user_id === userId || existingBattle.creator_wallet === walletAddress) {
    const error = new Error('You cannot join your own battle.')
    error.status = 400
    throw error
  }

  try {
    const escrow = escrowConfiguration()
    if (escrow.required && existingBattle.escrow_state !== 'awaiting_deposits') {
      const error = new Error('This battle was created before escrow was enabled and cannot accept deposits.')
      error.status = 409
      throw error
    }
  } catch (error) {
    if (error.status) throw error
    if (process.env.ESCROW_REQUIRED === 'true') throw error
  }

  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + existingBattle.duration_seconds * 1000)
  const deposit = await verifyOptionalDeposit({
    signature: payload.depositSignature,
    walletAddress,
    expectedLamports: Number(existingBattle.stake_lamports),
  })
  await assertDepositIsUnused(supabase, deposit?.signature)
  const { data, error } = await supabase
    .from('battles')
    .update({
      status: 'active',
      opponent_privy_user_id: userId,
      opponent_wallet: walletAddress,
      token_b_mint: token.mint,
      token_b_symbol: token.symbol,
      token_b_market_cap: token.marketCap,
      token_b_change_pct: 0,
      pot_lamports: Number(existingBattle.stake_lamports) * 2,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      updated_at: startsAt.toISOString(),
      ...(deposit ? {
        escrow_state: 'funded',
        escrow_account: deposit.treasury,
        escrow_program_id: deposit.programId,
        opponent_deposit_signature: deposit.signature,
      } : {}),
    })
    .eq('id', existingBattle.id)
    .eq('status', 'waiting')
    .is('opponent_wallet', null)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    const conflict = new Error('This battle was just joined by someone else.')
    conflict.status = 409
    throw conflict
  }
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

async function verifyOptionalDeposit({ signature, walletAddress, expectedLamports }) {
  const hasSignature = typeof signature === 'string' && signature.length > 0
  let config
  try {
    config = escrowConfiguration()
  } catch (error) {
    if (hasSignature || process.env.ESCROW_REQUIRED === 'true') throw error
    return null
  }
  if (!hasSignature) {
    if (config.required) {
      const error = new Error('Deposit the stake in escrow before creating or joining this battle.')
      error.status = 400
      throw error
    }
    return null
  }
  return verifyStakeTransfer({ signature, walletAddress, expectedLamports })
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    try {
      const { supabase } = createServerClients()
      const network = battleNetwork()
      // On-chain escrow battles are settled exclusively by the oracle path.
      // Never run the legacy treasury settlement path on either Solana network.
      const processed = ['devnet', 'mainnet'].includes(network) ? [] : await processActiveBattles(supabase, 25, network)
      let settlements = []
      if (!['devnet', 'mainnet'].includes(network)) {
        try {
          settlements = await settleFinishedBattles(supabase)
        } catch (settlementError) {
          if (settlementError.code !== 'SETTLEMENT_NOT_CONFIGURED') throw settlementError
        }
      }
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
    if (['devnet', 'mainnet'].includes(battleNetwork())) {
      return send(response, 409, { error: 'Use the on-chain escrow endpoint for this deployment.' })
    }
    const { privy, supabase } = createServerClients()
    const identity = await authenticateRequest(request, privy)
    const walletAddress = verifiedSolanaWallet(identity.user, request.body?.walletAddress)

    let battle
    if (request.body?.action === 'create') {
      battle = await createBattle({ supabase, userId: identity.userId, walletAddress, payload: request.body })
    } else if (request.body?.action === 'join') {
      battle = await joinBattle({ supabase, userId: identity.userId, walletAddress, payload: request.body })
    } else {
      return send(response, 400, { error: 'Unsupported battle action.' })
    }

    return send(response, 200, { battle: publicBattle(battle) })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Battle API error', error)
    return send(response, status, { error: status >= 500 ? 'Unable to update the battle right now.' : error.message })
  }
}
