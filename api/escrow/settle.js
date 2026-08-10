import { assertCronRequest, createServerSupabase } from '../lib/serverSupabase.js'
import { settleFinishedBattles } from '../lib/settlement.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    await assertCronRequest(request)
    const results = await settleFinishedBattles(createServerSupabase())
    return response.status(200).json({ settled: results.length, results })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Escrow settlement error', error)
    return response.status(status).json({ error: status === 401 ? error.message : 'Unable to settle battles.' })
  }
}
