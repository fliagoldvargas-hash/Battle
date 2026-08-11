import { PrivyClient } from '@privy-io/node'
import { createClient } from '@supabase/supabase-js'
import { PublicKey } from '@solana/web3.js'
import { getPumpFunToken } from './lib/pumpfun.js'

const ALLOWED_DURATIONS = new Set([1800, 3600, 7200, 14400, 28800, 86400])
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/

const send = (response, status, body) => response.status(status).json(body)

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing server environment variable: ${name}`)
  return value
}

function clients() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  if (!appId) throw new Error('Missing server environment variable: PRIVY_APP_ID')
  return {
    privy: new PrivyClient({ appId, appSecret: env('PRIVY_APP_SECRET') }),
    supabase: createClient(process.env.SUPABASE_URL || env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

async function walletFor(request, privy) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) throw Object.assign(new Error('Sign in with Privy before changing a battle.'), { status: 401 })
  const claims = await privy.utils().auth().verifyAccessToken(authorization.slice(7))
  const user = await privy.users()._get(claims.user_id)
  const wallet = request.body?.walletAddress
  if (!ADDRESS.test(wallet || '') || !user.linked_accounts?.some((item) => item.type === 'wallet' && item.chain_type === 'solana' && item.address === wallet)) {
    throw Object.assign(new Error('The selected Solana wallet is not linked to this Privy account.'), { status: 403 })
  }
  return { userId: claims.user_id, wallet }
}

async function rpc(method, params) {
  const response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'devnet-battle', method, params }),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error(payload.error?.message || 'Unable to read Devnet.')
  return payload.result
}

function decodeBattle(value) {
  const bytes = Buffer.from(value.data[0], 'base64')
  if (bytes.length < 249) throw new Error('Invalid on-chain battle account.')
  const pubkey = (offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58()
  const id = bytes.subarray(8, 24).toString('hex')
  return {
    id, creator: pubkey(24), opponent: pubkey(56), tokenA: pubkey(88), tokenB: pubkey(120),
    stake: Number(bytes.readBigUInt64LE(152)), duration: bytes.readUInt32LE(160),
    startedAt: Number(bytes.readBigInt64LE(164)), endsAt: Number(bytes.readBigInt64LE(172)), status: bytes.readUInt8(180),
  }
}

async function verifiedBattle({ signature, battleAddress, battleId, wallet }) {
  const programId = env('ESCROW_PROGRAM_ID')
  if (!SIGNATURE.test(signature || '') || !ADDRESS.test(battleAddress || '') || !/^[a-f0-9]{32}$/i.test(battleId || '')) {
    throw Object.assign(new Error('Invalid Devnet escrow confirmation.'), { status: 400 })
  }
  const transaction = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }])
  if (!transaction || transaction.meta?.err || !transaction.transaction.message.accountKeys.some((key) => key.pubkey === programId)) {
    throw Object.assign(new Error('The Devnet transaction was not confirmed by the escrow program.'), { status: 400 })
  }
  const info = await rpc('getAccountInfo', [battleAddress, { encoding: 'base64', commitment: 'confirmed' }])
  if (!info?.value || info.value.owner !== programId) throw Object.assign(new Error('Escrow battle account was not found on Devnet.'), { status: 400 })
  const battle = decodeBattle(info.value)
  if (battle.id !== battleId.toLowerCase() || battle.creator !== wallet) throw Object.assign(new Error('Devnet battle account does not match this wallet.'), { status: 400 })
  return battle
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' })
  try {
    if (process.env.BATTLE_NETWORK !== 'devnet') return send(response, 404, { error: 'Devnet escrow is not enabled in this deployment.' })
    const { privy, supabase } = clients()
    const identity = await walletFor(request, privy)
    const payload = request.body || {}
    const chain = await verifiedBattle({ ...payload, wallet: identity.wallet })
    if (payload.action === 'create') {
      if (!ALLOWED_DURATIONS.has(chain.duration) || chain.status !== 0) throw Object.assign(new Error('Unexpected Devnet battle state.'), { status: 409 })
      const token = await getPumpFunToken(chain.tokenA)
      const { data, error } = await supabase.from('battles').upsert({
        network: 'devnet', creator_privy_user_id: identity.userId, creator_wallet: identity.wallet,
        token_a_mint: token.mint, token_a_symbol: token.symbol, token_a_market_cap: token.marketCap, token_a_change_pct: 0,
        stake_lamports: chain.stake, pot_lamports: chain.stake, duration_seconds: chain.duration,
        escrow_state: 'awaiting_deposits', escrow_program_id: env('ESCROW_PROGRAM_ID'), escrow_account: payload.vaultAddress,
        onchain_battle_address: payload.battleAddress, onchain_battle_id: chain.id, vault_address: payload.vaultAddress,
        creator_deposit_signature: payload.signature,
      }, { onConflict: 'network,onchain_battle_address' }).select('*').single()
      if (error) throw error
      return send(response, 200, { battle: data })
    }
    if (payload.action === 'join') {
      if (chain.status !== 1 || chain.opponent !== identity.wallet) throw Object.assign(new Error('Unexpected Devnet join state.'), { status: 409 })
      const token = await getPumpFunToken(chain.tokenB)
      const { data, error } = await supabase.from('battles').update({
        status: 'active', opponent_privy_user_id: identity.userId, opponent_wallet: identity.wallet,
        token_b_mint: token.mint, token_b_symbol: token.symbol, token_b_market_cap: token.marketCap, token_b_change_pct: 0,
        pot_lamports: chain.stake * 2, starts_at: new Date(chain.startedAt * 1000).toISOString(), ends_at: new Date(chain.endsAt * 1000).toISOString(),
        escrow_state: 'funded', opponent_deposit_signature: payload.signature, updated_at: new Date().toISOString(),
      }).eq('network', 'devnet').eq('onchain_battle_address', payload.battleAddress).eq('status', 'waiting').select('*').single()
      if (error) throw error
      return send(response, 200, { battle: data })
    }
    return send(response, 400, { error: 'Unsupported Devnet escrow action.' })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Devnet escrow sync error', error)
    return send(response, status, { error: status >= 500 ? 'Unable to synchronize the Devnet battle.' : error.message })
  }
}
