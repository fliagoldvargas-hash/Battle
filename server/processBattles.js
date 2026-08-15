import { getPumpFunToken } from './pumpfun.js'

export function performancePercent(current, initial) {
  if (!Number.isFinite(current) || !Number.isFinite(initial) || initial <= 0) return null
  return Number((((current - initial) / initial) * 100).toFixed(4))
}

function selectWinner(changeA, changeB, mintA, mintB) {
  if (changeA == null || changeB == null) return null
  return changeA > changeB ? mintA : mintB
}

async function processBattle(supabase, battle) {
  const [tokenA, tokenB] = await Promise.all([
    getPumpFunToken(battle.token_a_mint),
    getPumpFunToken(battle.token_b_mint),
  ])
  const changeA = performancePercent(tokenA.marketCap, Number(battle.token_a_market_cap))
  const changeB = performancePercent(tokenB.marketCap, Number(battle.token_b_market_cap))

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
  if (ended && changeA != null && changeB != null) {
    const winnerMint = selectWinner(changeA, changeB, battle.token_a_mint, battle.token_b_mint)
    const winner = winnerMint === battle.token_a_mint
      ? { mint: battle.token_a_mint, symbol: battle.token_a_symbol }
      : winnerMint === battle.token_b_mint
        ? { mint: battle.token_b_mint, symbol: battle.token_b_symbol }
        : null
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

export async function processActiveBattles(supabase, limit = 100, network = 'mainnet') {
  const { data: battles, error } = await supabase
    .from('battles')
    .select('*')
    .eq('network', network)
    .eq('status', 'active')
    .eq('escrow_state', 'funded')
    .not('ends_at', 'is', null)
    .lte('starts_at', new Date().toISOString())
    .limit(limit)
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
  return results
}
