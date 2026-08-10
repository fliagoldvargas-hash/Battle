import { PrivyClient } from '@privy-io/node'
import { assertCronRequest } from '../lib/serverSupabase.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    assertCronRequest(request)
    if (process.env.ESCROW_TREASURY_WALLET_ID) {
      return response.status(200).json({ configured: true, walletId: process.env.ESCROW_TREASURY_WALLET_ID, address: process.env.ESCROW_TREASURY_ADDRESS })
    }
    const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
    if (!appId || !process.env.PRIVY_APP_SECRET) throw new Error('Privy server credentials are not configured.')
    const privy = new PrivyClient({ appId, appSecret: process.env.PRIVY_APP_SECRET })
    const wallet = await privy.wallets().create({ chain_type: 'solana', display_name: 'Battle Escrow Treasury' })
    return response.status(201).json({ configured: false, walletId: wallet.id, address: wallet.address })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Escrow bootstrap error', error)
    return response.status(status).json({ error: status === 401 ? error.message : 'Unable to provision the escrow treasury.' })
  }
}

