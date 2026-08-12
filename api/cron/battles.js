import { assertCronRequest, createServerSupabase } from '../../server/serverSupabase.js'
import { processActiveBattles } from '../../server/processBattles.js'
import { settleFinishedBattles } from '../../server/settlement.js'
import { settleDevnetBattles } from '../../server/devnetOracle.js'

const send = (response, status, body) => response.status(status).json(body)
const isDevnetDeployment = () => (
  process.env.BATTLE_NETWORK === 'devnet' || process.env.VITE_BATTLE_NETWORK === 'devnet'
)

export default async function handler(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })

  try {
    await assertCronRequest(request)
    const supabase = createServerSupabase()
    if (isDevnetDeployment()) {
      const settlements = await settleDevnetBattles(supabase)
      return send(response, 200, { processed: settlements.length, results: settlements, settled: settlements.length })
    }
    const results = await processActiveBattles(supabase)
    let settlements = []
    try {
      settlements = await settleFinishedBattles(supabase)
    } catch (settlementError) {
      if (settlementError.code !== 'SETTLEMENT_NOT_CONFIGURED') throw settlementError
    }
    return send(response, 200, { processed: results.length, results, settled: settlements.length, settlements })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Battle cron error', error)
    return send(response, status, { error: status === 401 ? error.message : 'Unable to process battles.' })
  }
}
