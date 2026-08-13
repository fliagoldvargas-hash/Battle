import { PrivyClient } from '@privy-io/node'
import { createClient } from '@supabase/supabase-js'
import { getFeeSchedule, quoteFeeForWallet, saveFeeSchedule, validateFeeSchedule } from '../server/holderFees.js'

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const send = (response, status, body) => response.status(status).json(body)

function required(name) {
  const value = process.env[name]
  if (!value) throw Object.assign(new Error(`Missing ${name}.`), { status: 503 })
  return value.trim()
}

function server() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID
  if (!appId) throw Object.assign(new Error('Missing PRIVY_APP_ID.'), { status: 503 })
  return {
    adminWallet: required('PROTOCOL_ADMIN_WALLET'),
    privy: new PrivyClient({ appId, appSecret: required('PRIVY_APP_SECRET') }),
    supabase: createClient(process.env.SUPABASE_URL || required('VITE_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

async function assertAdmin(request, privy, adminWallet) {
  const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : null
  const wallet = request.body?.walletAddress
  if (!token) throw Object.assign(new Error('Connect the protocol owner wallet first.'), { status: 401 })
  if (!ADDRESS.test(wallet || '') || wallet !== adminWallet) throw Object.assign(new Error('This wallet is not the configured protocol owner.'), { status: 403 })
  const claims = await privy.utils().auth().verifyAccessToken(token)
  const user = await privy.users()._get(claims.user_id)
  const linked = user.linked_accounts?.some((account) => account.type === 'wallet' && account.chain_type === 'solana' && account.address === wallet)
  if (!linked) throw Object.assign(new Error('The selected wallet is not linked to this Privy session.'), { status: 403 })
}

export default async function handler(request, response) {
  try {
    const { adminWallet, privy, supabase } = server()
    if (request.method === 'GET') {
      const schedule = request.query?.wallet && ADDRESS.test(request.query.wallet)
        ? await quoteFeeForWallet(supabase, request.query.wallet)
        : await getFeeSchedule(supabase)
      return send(response, 200, { configured: true, adminWallet, ...schedule })
    }
    if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' })
    await assertAdmin(request, privy, adminWallet)
    const schedule = await validateFeeSchedule(request.body)
    const saved = await saveFeeSchedule(supabase, schedule, adminWallet)
    return send(response, 200, { saved: true, adminWallet, ...saved })
  } catch (error) {
    const status = error?.status || 500
    if (status >= 500) console.error('Holder fee configuration failed', error)
    return send(response, status, { error: status >= 500 ? 'Holder fee configuration is temporarily unavailable.' : error.message })
  }
}
