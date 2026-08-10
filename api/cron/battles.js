import { getPumpFunToken } from '../lib/pumpfun.js'
import { assertCronRequest, createServerSupabase } from '../lib/serverSupabase.js'

const send = (response, status, body) => response.status(status).json(body)

function performancePercent(current, initial) {
  if (!Number.isFinite(current) || !Number.isFinite(initial) || initial <= 0) return null
  return Number((((current - initial) / initial) * 100).toFixed(4))
}

async function processBattle(supabase, battle) {
  const [tokenA, tokenB] = await Promise.all([
    getPumpFunToken(battle.token_a_mint),
    getPumpFunToken(battle.token_b_mint),
  ])

  const initialA = Number(battle.token_a_market_cap)
  const initialB = Number(battle.token_b_market_cap)
  const changeA = performancePercent(tokenA.marketCap, initialA)
  const changeB = performancePercent(tokenB.marketCap, initialB)

  const { error: snapshotError } = await supabase.from('battle_price_snapshots').insert({
    battle_id: battle.id,
    token_a_price_usd: tokenA.priceUsd ?? 0,
    token_b_price_usd: tokenB.priceUsd ?? 0,
  })
  if (snapshotError && snapshotError.code !== '23505') throw snapshotError

  const ended = new Date(battle.ends_at).getTime() <= Date.now()
  const update = {
    token_a_change_pct: changeA,
    token_b_change_pct: changeB,
    updated_at: new Date().toISOString(),
  }

  if (ended) {
    const winner = changeA == null || changeB == null || changeA === changeB
      ? null
      : changeA > changeB
        ? { mint: battle.token_a_mint, symbol: battle.token_a_symbol }
        : { mint: battle.token_b_mint, symbol: battle.token_b_symbol }
    Object.assign(update, {
      status: 'finished',
      winner_mint: winner?.mint ?? null,
      winner_symbol: winner?.symbol ?? null,
    })
  }

  const { error } = await supabase.from('battles').update(update).eq('id', battle.id).eq('status', 'active')
  if (error) throw error
  return { id: battle.id, status: update.status ?? 'active', ended }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })

  try {
    assertCronRequest(request)
    const supabase = createServerSupabase()
    const { data: battles, error } = await supabase
      .from('battles')
      .select('*')
      .eq('status', 'active')
      .not('ends_at', 'is', null)
      .lte('starts_at', new Date().toISOString())
      .limit(100)
    if (error) throw error

    const results = []
    for (const battle of battles ?? []) {
      try {
        results.push(await processBattle(supabase, battle))
      } catch (battleError) {
        console.error('Battle processing failed', { battleId: battle.id, error: battleError })
        results.push({ id: battle.id, error: 'processing_failed' })
      }
    }
    return send(response, 200, { processed: results.length, results })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Battle cron error', error)
    return send(response, status, { error: status === 401 ? error.message : 'Unable to process battles.' })
  }
}
