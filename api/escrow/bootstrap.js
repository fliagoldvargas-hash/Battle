import { PrivyClient } from '@privy-io/node'

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const MAX_SETTLEMENT_LAMPORTS = '20000000000'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    const error = new Error(`Missing ${name}.`)
    error.status = 503
    throw error
  }
  return value
}

function client() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  return new PrivyClient({ appId: required(appId ? 'PRIVY_APP_ID' : 'VITE_PRIVY_APP_ID'), appSecret: required('PRIVY_APP_SECRET') })
}

async function assertProtocolOwner(request, privy) {
  const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : null
  const walletAddress = request.body?.walletAddress
  const adminWallet = required('PROTOCOL_ADMIN_WALLET')
  if (!token) {
    const error = new Error('Connect the protocol owner wallet first.')
    error.status = 401
    throw error
  }
  if (!SOLANA_ADDRESS.test(walletAddress || '') || walletAddress !== adminWallet) {
    const error = new Error('Only the configured protocol owner can provision the treasury.')
    error.status = 403
    throw error
  }
  const claims = await privy.utils().auth().verifyAccessToken(token)
  const user = await privy.users()._get(claims.user_id)
  const linked = user.linked_accounts?.some((account) => (
    account.type === 'wallet' && account.chain_type === 'solana' && account.address === walletAddress
  ))
  if (!linked) {
    const error = new Error('The selected wallet is not linked to this Privy session.')
    error.status = 403
    throw error
  }
  return { userId: claims.user_id, walletAddress }
}

async function existingTreasury(privy) {
  const configuredId = process.env.ESCROW_TREASURY_WALLET_ID
  if (configuredId) return privy.wallets().get(configuredId)
  for await (const wallet of privy.wallets().list({ chain_type: 'solana', external_id: 'battle-mainnet-treasury' })) return wallet
  return null
}

function treasuryPolicy(owner) {
  return {
    chain_type: 'solana',
    name: 'Battle Mainnet settlement signer',
    owner: { user_id: owner },
    version: '1.0',
    rules: [{
      name: 'Allow capped SOL settlement transfers',
      action: 'ALLOW',
      method: 'signAndSendTransaction',
      conditions: [
        { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: SYSTEM_PROGRAM },
        { field_source: 'solana_system_program_instruction', field: 'instructionName', operator: 'eq', value: 'Transfer' },
        { field_source: 'solana_system_program_instruction', field: 'Transfer.lamports', operator: 'lte', value: MAX_SETTLEMENT_LAMPORTS },
      ],
    }],
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    return response.status(200).json({
      configured: Boolean(process.env.ESCROW_TREASURY_WALLET_ID && process.env.ESCROW_TREASURY_ADDRESS),
      address: process.env.ESCROW_TREASURY_ADDRESS || null,
      settlementMode: process.env.BATTLE_SETTLEMENT_MODE || null,
    })
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    const privy = client()
    const { userId } = await assertProtocolOwner(request, privy)
    const existing = await existingTreasury(privy)
    if (existing) {
      return response.status(200).json({
        configured: Boolean(process.env.ESCROW_TREASURY_WALLET_ID),
        walletId: existing.id,
        address: existing.address,
        message: 'Treasury already exists. Set its ID and address in Vercel before enabling treasury mode.',
      })
    }

    const signerPublicKey = required('PRIVY_TREASURY_AUTHORIZATION_PUBLIC_KEY')
    const keyQuorum = await privy.keyQuorums().create({
      display_name: 'Battle Mainnet Vercel settlement signer',
      public_keys: [signerPublicKey],
      authorization_threshold: 1,
    })
    const policy = await privy.policies().create(treasuryPolicy(userId))
    const wallet = await privy.wallets().create({
      chain_type: 'solana',
      display_name: 'Battle Mainnet Treasury',
      external_id: 'battle-mainnet-treasury',
      owner: { user_id: userId },
      additional_signers: [{ signer_id: keyQuorum.id, override_policy_ids: [policy.id] }],
    })
    return response.status(201).json({
      configured: false,
      walletId: wallet.id,
      address: wallet.address,
      policyId: policy.id,
      keyQuorumId: keyQuorum.id,
      message: 'Treasury created. Store only walletId and address in Vercel; keep the authorization private key encrypted as a server-only secret.',
    })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Treasury bootstrap error', error)
    return response.status(status).json({ error: status >= 500 ? 'Unable to provision the secure treasury.' : error.message })
  }
}
