import { PrivyClient } from '@privy-io/node'
import { createClient } from '@supabase/supabase-js'
import { PublicKey } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { getPumpFunToken } from '../server/pumpfun.js'

const ALLOWED_DURATIONS = new Set([60, 1800, 3600, 7200, 14400, 28800, 86400])
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

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function confirmedTransaction(signature) {
  // Wallet providers can return a signature before every Devnet RPC replica
  // exposes the transaction. Polling here prevents a valid signed battle from
  // being rejected merely because the server checked a few hundred ms early.
  for (const delay of [0, 300, 600, 900, 1_200, 1_500]) {
    if (delay) await pause(delay)
    const transaction = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }])
    if (transaction) return transaction
  }
  return null
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

function derivedAccounts(programId, battleId) {
  const id = Buffer.from(battleId, 'hex')
  const [battle] = PublicKey.findProgramAddressSync([Buffer.from('battle'), id], new PublicKey(programId))
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBytes()], new PublicKey(programId))
  return { battle: battle.toBase58(), vault: vault.toBase58() }
}

function transactionAccounts(transaction) {
  return transaction.transaction.message.accountKeys.map((key) => typeof key === 'string' ? key : key.pubkey)
}

function base58Decode(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes = [0]
  for (const character of value) {
    let carry = alphabet.indexOf(character)
    if (carry < 0) throw new Error('Invalid encoded Solana instruction.')
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58
      bytes[index] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const character of value) {
    if (character !== alphabet[0]) break
    bytes.push(0)
  }
  return Buffer.from(bytes.reverse())
}

function hasEscrowInstruction(transaction, programId, instructionName) {
  const keys = transactionAccounts(transaction)
  const discriminator = createHash('sha256').update(`global:${instructionName}`).digest().subarray(0, 8)
  return transaction.transaction.message.instructions.some((instruction) => (
    keys[instruction.programIdIndex] === programId && typeof instruction.data === 'string' && base58Decode(instruction.data).subarray(0, 8).equals(discriminator)
  ))
}

async function verifiedBattle({ signature, battleAddress, vaultAddress, battleId, instructionName }) {
  const programId = env('ESCROW_PROGRAM_ID')
  if (!SIGNATURE.test(signature || '') || !ADDRESS.test(battleAddress || '') || !/^[a-f0-9]{32}$/i.test(battleId || '')) {
    throw Object.assign(new Error('Invalid Devnet escrow confirmation.'), { status: 400 })
  }
  const expected = derivedAccounts(programId, battleId)
  if (expected.battle !== battleAddress || expected.vault !== vaultAddress) {
    throw Object.assign(new Error('Devnet escrow addresses do not match the battle identifier.'), { status: 400 })
  }
  const transaction = await confirmedTransaction(signature)
  const accounts = transaction ? transactionAccounts(transaction) : []
  if (!transaction || transaction.meta?.err || !accounts.includes(programId) || !accounts.includes(battleAddress) || !accounts.includes(expected.vault) || !hasEscrowInstruction(transaction, programId, instructionName)) {
    throw Object.assign(new Error('The Devnet transaction was not confirmed by the escrow program.'), { status: 400 })
  }
  const info = await rpc('getAccountInfo', [battleAddress, { encoding: 'base64', commitment: 'confirmed' }])
  if (!info?.value || info.value.owner !== programId) throw Object.assign(new Error('Escrow battle account was not found on Devnet.'), { status: 400 })
  const battle = decodeBattle(info.value)
  if (battle.id !== battleId.toLowerCase()) throw Object.assign(new Error('Devnet battle account does not match its identifier.'), { status: 400 })
  return battle
}

async function verifiedClosedBattle({ signature, battleAddress, vaultAddress, battleId, instructionName }) {
  const programId = env('ESCROW_PROGRAM_ID')
  if (!SIGNATURE.test(signature || '') || !ADDRESS.test(battleAddress || '') || !ADDRESS.test(vaultAddress || '') || !/^[a-f0-9]{32}$/i.test(battleId || '')) {
    throw Object.assign(new Error('Invalid Devnet escrow confirmation.'), { status: 400 })
  }
  const expected = derivedAccounts(programId, battleId)
  if (expected.battle !== battleAddress || expected.vault !== vaultAddress) {
    throw Object.assign(new Error('Devnet escrow addresses do not match the battle identifier.'), { status: 400 })
  }
  const transaction = await confirmedTransaction(signature)
  const accounts = transaction ? transactionAccounts(transaction) : []
  if (!transaction || transaction.meta?.err || !accounts.includes(programId) || !accounts.includes(battleAddress) || !accounts.includes(vaultAddress) || !hasEscrowInstruction(transaction, programId, instructionName)) {
    throw Object.assign(new Error('The Devnet transaction was not confirmed by the escrow program.'), { status: 400 })
  }
}

async function saveCreatedBattle({ supabase, identity, chain, signature, battleAddress, vaultAddress }) {
  const token = await getPumpFunToken(chain.tokenA)
  const { data, error } = await supabase.from('battles').upsert({
    network: 'devnet', creator_privy_user_id: identity.userId, creator_wallet: identity.wallet,
    token_a_mint: token.mint, token_a_symbol: token.symbol, token_a_market_cap: token.marketCap, token_a_change_pct: 0,
    stake_lamports: chain.stake, pot_lamports: chain.stake, duration_seconds: chain.duration,
    escrow_state: 'awaiting_deposits', escrow_program_id: env('ESCROW_PROGRAM_ID'), escrow_account: vaultAddress,
    onchain_battle_address: battleAddress, onchain_battle_id: chain.id, vault_address: vaultAddress,
    creator_deposit_signature: signature,
  }, { onConflict: 'network,onchain_battle_address' }).select('*').single()
  if (error) throw error
  return data
}

async function saveJoinedBattle({ supabase, identity, chain, signature, battleAddress }) {
  const [tokenA, tokenB] = await Promise.all([getPumpFunToken(chain.tokenA), getPumpFunToken(chain.tokenB)])
  const { data, error } = await supabase.from('battles').update({
    status: 'active', opponent_privy_user_id: identity.userId, opponent_wallet: identity.wallet,
    token_a_mint: tokenA.mint, token_a_symbol: tokenA.symbol, token_a_market_cap: tokenA.marketCap, token_a_change_pct: 0,
    token_b_mint: tokenB.mint, token_b_symbol: tokenB.symbol, token_b_market_cap: tokenB.marketCap, token_b_change_pct: 0,
    pot_lamports: chain.stake * 2, starts_at: new Date(chain.startedAt * 1000).toISOString(), ends_at: new Date(chain.endsAt * 1000).toISOString(),
    escrow_state: 'funded', opponent_deposit_signature: signature, updated_at: new Date().toISOString(),
  }).eq('network', 'devnet').eq('onchain_battle_address', battleAddress).eq('status', 'waiting').select('*').maybeSingle()
  if (error) throw error
  if (data) return data

  // A previous request may already have synchronized this exact on-chain join.
  const { data: existing, error: existingError } = await supabase.from('battles')
    .select('*').eq('network', 'devnet').eq('onchain_battle_address', battleAddress).maybeSingle()
  if (existingError) throw existingError
  if (existing?.opponent_wallet === identity.wallet && existing.status === 'active') return existing
  throw Object.assign(new Error('The on-chain battle could not be matched to an open Devnet battle.'), { status: 409 })
}

async function recoverWaitingBattles({ supabase, identity }) {
  const programId = env('ESCROW_PROGRAM_ID')
  const accounts = await rpc('getProgramAccounts', [programId, { encoding: 'base64', commitment: 'confirmed' }])
  const recovered = []

  for (const account of accounts) {
    if (!account.account?.data?.[0]) continue
    let chain
    try {
      chain = decodeBattle({ data: account.account.data })
    } catch {
      continue
    }
    if (!ALLOWED_DURATIONS.has(chain.duration)) continue

    const { vault } = derivedAccounts(programId, chain.id)
    const signatures = await rpc('getSignaturesForAddress', [account.pubkey, { limit: 10, commitment: 'confirmed' }])
    const transaction = signatures.find((entry) => entry.err === null)
    if (!transaction) continue
    if (chain.status === 0 && chain.creator === identity.wallet) {
      recovered.push(await saveCreatedBattle({
        supabase, identity, chain, signature: transaction.signature, battleAddress: account.pubkey, vaultAddress: vault,
      }))
    }
    if (chain.status === 1 && chain.opponent === identity.wallet) {
      recovered.push(await saveJoinedBattle({
        supabase, identity, chain, signature: transaction.signature, battleAddress: account.pubkey,
      }))
    }
  }

  return recovered
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' })
  try {
    if (process.env.BATTLE_NETWORK !== 'devnet') return send(response, 404, { error: 'Devnet escrow is not enabled in this deployment.' })
    const { privy, supabase } = clients()
    const identity = await walletFor(request, privy)
    const payload = request.body || {}
    if (payload.action === 'recover') {
      const battles = await recoverWaitingBattles({ supabase, identity })
      return send(response, 200, { battles })
    }
    if (payload.action === 'cancel' || payload.action === 'refund') {
      await verifiedClosedBattle({ ...payload, instructionName: payload.action === 'cancel' ? 'cancel_waiting' : 'refund_expired' })
      const { data: existing, error: existingError } = await supabase.from('battles')
        .select('*').eq('network', 'devnet').eq('onchain_battle_address', payload.battleAddress).maybeSingle()
      if (existingError) throw existingError
      if (!existing) throw Object.assign(new Error('Devnet battle was not found.'), { status: 404 })
      if (payload.action === 'cancel' && existing.creator_wallet !== identity.wallet) {
        throw Object.assign(new Error('Only the creator can cancel an open battle.'), { status: 403 })
      }
      if (payload.action === 'refund' && identity.wallet !== existing.creator_wallet && identity.wallet !== existing.opponent_wallet) {
        throw Object.assign(new Error('Only a battle participant can request this refund.'), { status: 403 })
      }
      const { data, error } = await supabase.from('battles').update({
        status: 'cancelled', escrow_state: 'refunded', settlement_signature: payload.signature, updated_at: new Date().toISOString(),
      }).eq('id', existing.id).eq('status', payload.action === 'cancel' ? 'waiting' : 'active').select('*').single()
      if (error) throw error
      return send(response, 200, { battle: data })
    }
    const chain = await verifiedBattle({ ...payload, instructionName: payload.action === 'create' ? 'create_battle' : 'join_battle' })
    if (payload.action === 'create') {
      if (!ALLOWED_DURATIONS.has(chain.duration) || chain.status !== 0 || chain.creator !== identity.wallet) throw Object.assign(new Error('Unexpected Devnet battle state.'), { status: 409 })
      const data = await saveCreatedBattle({
        supabase, identity, chain, signature: payload.signature, battleAddress: payload.battleAddress, vaultAddress: payload.vaultAddress,
      })
      return send(response, 200, { battle: data })
    }
    if (payload.action === 'join') {
      if (chain.status !== 1 || chain.opponent !== identity.wallet) throw Object.assign(new Error('Unexpected Devnet join state.'), { status: 409 })
      const data = await saveJoinedBattle({
        supabase, identity, chain, signature: payload.signature, battleAddress: payload.battleAddress,
      })
      return send(response, 200, { battle: data })
    }
    return send(response, 400, { error: 'Unsupported Devnet escrow action.' })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Devnet escrow sync error', error)
    return send(response, status, { error: status >= 500 ? 'Unable to synchronize the Devnet battle.' : error.message })
  }
}
