import { PrivyClient } from '@privy-io/node'
import { createServerSupabase } from './lib/serverSupabase.js'
import { recordDeposit, escrowConfiguration } from './lib/escrow.js'

const send = (response, status, body) => response.status(status).json(body)

function bearer(request) {
  const value = request.headers.authorization
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null
}

function clients() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  if (!appId || !process.env.PRIVY_APP_SECRET) throw new Error('Privy server credentials are not configured.')
  return new PrivyClient({ appId, appSecret: process.env.PRIVY_APP_SECRET })
}

async function identity(request) {
  const token = bearer(request)
  if (!token) {
    const error = new Error('Sign in with Privy before confirming a deposit.')
    error.status = 401
    throw error
  }
  try {
    const privy = clients()
    const claims = await privy.utils().auth().verifyAccessToken(token)
    const user = await privy.users()._get(claims.user_id)
    return { userId: claims.user_id, user }
  } catch {
    const error = new Error('Your Privy session could not be verified. Reconnect your wallet and try again.')
    error.status = 401
    throw error
  }
}

function linkedWallet(user, address) {
  const wallet = user.linked_accounts?.find((account) => (
    account.type === 'wallet' && account.chain_type === 'solana' && account.address === address
  ))
  if (!wallet) {
    const error = new Error('The selected Solana wallet is not linked to this Privy account.')
    error.status = 403
    throw error
  }
  return wallet.address
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    try {
      const config = escrowConfiguration()
      return send(response, 200, {
        configured: true,
        treasury: config.treasury,
        feeTreasury: config.feeTreasury,
        programConfigured: Boolean(config.programId),
        required: config.required,
      })
    } catch (error) {
      return send(response, 200, { configured: false, programConfigured: false, required: false, error: error.message })
    }
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return send(response, 405, { error: 'Method not allowed.' })
  }
  try {
    const identityResult = await identity(request)
    const { battleId, walletAddress, role, signature } = request.body ?? {}
    if (!battleId || !['creator', 'opponent'].includes(role) || !signature) {
      return send(response, 400, { error: 'battleId, role and signature are required.' })
    }
    const supabase = createServerSupabase()
    const { data: battle, error: readError } = await supabase.from('battles').select('*').eq('id', battleId).maybeSingle()
    if (readError) throw readError
    if (!battle) return send(response, 404, { error: 'Battle not found.' })
    const address = linkedWallet(identityResult.user, walletAddress)
    const expectedLamports = Number(battle.stake_lamports)
    const owner = role === 'creator' ? battle.creator_wallet : battle.opponent_wallet
    if (owner !== address) return send(response, 403, { error: 'This wallet is not the selected battle participant.' })
    const result = await recordDeposit({ supabase, battleId, walletAddress: address, role, signature, expectedLamports })
    return send(response, 200, { battle: result.battle, verified: result.verified })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Escrow API error', error)
    return send(response, status, { error: status >= 500 ? 'Unable to confirm the escrow deposit.' : error.message })
  }
}
