import { PrivyClient } from '@privy-io/node'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { createHash } from 'node:crypto'

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const TOKEN_PROGRAM_IDS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdYdY5rTyEFD9R29qn6R7b2hv3ih3dYY8kLAs',
])
const onchainNetwork = () => ['devnet', 'mainnet'].includes(process.env.BATTLE_NETWORK)

const send = (response, status, body) => response.status(status).json(body)
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out }
const u16 = (value) => { const out = Buffer.alloc(2); out.writeUInt16LE(Number(value)); return out }

function required(name) {
  const value = process.env[name]
  if (!value) throw Object.assign(new Error(`Missing ${name}.`), { status: 503 })
  return value.trim()
}

function server() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  if (!appId) throw Object.assign(new Error('Missing PRIVY_APP_ID.'), { status: 503 })
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(required('ORACLE_SETTLEMENT_AUTHORITY_SECRET'))))
  return {
    authority,
    adminWallet: required('PROTOCOL_ADMIN_WALLET'),
    programId: new PublicKey(required('ESCROW_PROGRAM_ID')),
    connection: new Connection(process.env.SOLANA_RPC_URL || (process.env.BATTLE_NETWORK === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'), 'confirmed'),
    privy: new PrivyClient({ appId, appSecret: required('PRIVY_APP_SECRET') }),
  }
}

async function authenticatedAdmin(request, privy, expectedWallet) {
  const token = request.headers.authorization
  if (!token?.startsWith('Bearer ')) throw Object.assign(new Error('Connect the protocol owner wallet first.'), { status: 401 })
  const wallet = request.body?.walletAddress
  if (!ADDRESS.test(wallet || '') || wallet !== expectedWallet) throw Object.assign(new Error('This wallet is not the configured protocol owner.'), { status: 403 })
  const claims = await privy.utils().auth().verifyAccessToken(token.slice(7))
  const user = await privy.users()._get(claims.user_id)
  const linked = user.linked_accounts?.some((account) => account.type === 'wallet' && account.chain_type === 'solana' && account.address === wallet)
  if (!linked) throw Object.assign(new Error('The selected wallet is not linked to this Privy session.'), { status: 403 })
}

function accounts(programId) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const [holderConfig] = PublicKey.findProgramAddressSync([Buffer.from('holder-config')], programId)
  return { config, holderConfig }
}

function validateSchedule(input) {
  let holderMint
  try {
    holderMint = new PublicKey(String(input?.holderMint || '').trim())
  } catch {
    throw Object.assign(new Error('Enter a valid Solana token CA.'), { status: 400 })
  }
  const minimums = input?.tierMinimums?.map((value) => BigInt(value))
  const feeBps = input?.feeBps?.map((value) => Number(value))
  if (minimums?.length !== 4 || feeBps?.length !== 5 || minimums.some((value) => value <= 0n)) throw Object.assign(new Error('Provide four positive token-balance thresholds and five rates.'), { status: 400 })
  if (minimums.some((value, index) => index > 0 && value <= minimums[index - 1])) throw Object.assign(new Error('Each holder tier must be higher than the preceding tier.'), { status: 400 })
  if (feeBps.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)) throw Object.assign(new Error('Fee rates must be whole basis points between 0 and 10,000.'), { status: 400 })
  if (feeBps.some((value, index) => index > 0 && value > feeBps[index - 1])) throw Object.assign(new Error('Holder tiers cannot raise the platform fee.'), { status: 400 })
  return { holderMint, minimums, feeBps }
}

async function ensureMint(connection, mint) {
  const account = await connection.getAccountInfo(mint, 'confirmed')
  if (!account || !TOKEN_PROGRAM_IDS.has(account.owner.toBase58()) || account.data.length < 82 || account.data[45] !== 1) {
    throw Object.assign(new Error('The supplied CA is not an initialized SPL or Token-2022 mint.'), { status: 400 })
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    if (!onchainNetwork()) return send(response, 404, { error: 'Holder fee management is not available on this network.' })
    const adminWallet = process.env.PROTOCOL_ADMIN_WALLET?.trim()
    return send(response, 200, { configured: Boolean(adminWallet), adminWallet: adminWallet || null })
  }
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' })
  if (!onchainNetwork()) return send(response, 404, { error: 'Holder fee management is not available on this network.' })

  try {
    const { authority, adminWallet, programId, connection, privy } = server()
    await authenticatedAdmin(request, privy, adminWallet)
    const { config, holderConfig } = accounts(programId)
    const action = request.body?.action

    if (action === 'initialize') {
      if (await connection.getAccountInfo(holderConfig, 'confirmed')) return send(response, 200, { initialized: false, alreadyExists: true })
      const instruction = new TransactionInstruction({
        programId,
        data: discriminator('initialize_holder_config'),
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: holderConfig, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
      })
      const signature = await connection.sendTransaction(new Transaction().add(instruction), [authority])
      await connection.confirmTransaction(signature, 'confirmed')
      return send(response, 200, { initialized: true, signature })
    }

    if (action === 'set') {
      const { holderMint, minimums, feeBps } = validateSchedule(request.body)
      await ensureMint(connection, holderMint)
      if (!await connection.getAccountInfo(holderConfig, 'confirmed')) throw Object.assign(new Error('Initialize holder fees before configuring the token CA.'), { status: 409 })
      const data = Buffer.concat([discriminator('set_holder_config'), holderMint.toBuffer(), ...minimums.map(u64), ...feeBps.map(u16)])
      const instruction = new TransactionInstruction({
        programId, data,
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: holderConfig, isSigner: false, isWritable: true },
          { pubkey: holderMint, isSigner: false, isWritable: false },
        ],
      })
      const signature = await connection.sendTransaction(new Transaction().add(instruction), [authority])
      await connection.confirmTransaction(signature, 'confirmed')
      return send(response, 200, { saved: true, signature })
    }

    throw Object.assign(new Error('Unsupported holder fee action.'), { status: 400 })
  } catch (error) {
    console.error('Holder fee configuration rejected', error instanceof Error ? error.message : error)
    return send(response, error?.status || 500, { error: error instanceof Error ? error.message : 'Holder fee configuration failed.' })
  }
}
