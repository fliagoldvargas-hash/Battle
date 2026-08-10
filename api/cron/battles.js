import { assertCronRequest, createServerSupabase } from '../lib/serverSupabase.js'
import { processActiveBattles } from '../lib/processBattles.js'

const send = (response, status, body) => response.status(status).json(body)

export default async function handler(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })

  try {
    assertCronRequest(request)
    const supabase = createServerSupabase()
    const results = await processActiveBattles(supabase)
    return send(response, 200, { processed: results.length, results })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Battle cron error', error)
    return send(response, status, { error: status === 401 ? error.message : 'Unable to process battles.' })
  }
}
