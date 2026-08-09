import { supabase } from '../lib/supabase'

const LAMPORTS_PER_SOL = 1_000_000_000

const shortAddress = (address) => {
  if (!address) return 'Unknown'
  return `${address.slice(0, 8)}...${address.slice(-4)}`
}

const durationLabel = (seconds) => {
  if (!seconds) return '—'
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${seconds / 60}m`
}

export const mapBattle = (battle) => ({
  id: battle.id,
  status: battle.status,
  tokenA: {
    symbol: battle.token_a_symbol,
    mc: battle.token_a_market_cap ? `$${Number(battle.token_a_market_cap).toLocaleString()}` : '—',
    perf: battle.token_a_change_pct == null ? undefined : Number(battle.token_a_change_pct),
  },
  tokenB: battle.token_b_mint
    ? {
        symbol: battle.token_b_symbol,
        mc: battle.token_b_market_cap ? `$${Number(battle.token_b_market_cap).toLocaleString()}` : '—',
        perf: battle.token_b_change_pct == null ? undefined : Number(battle.token_b_change_pct),
      }
    : null,
  stake: Number(battle.stake_lamports) / LAMPORTS_PER_SOL,
  pot: Number(battle.pot_lamports) / LAMPORTS_PER_SOL,
  durationSecs: battle.duration_seconds,
  durationLabel: durationLabel(battle.duration_seconds),
  endTime: battle.ends_at ? Math.floor(new Date(battle.ends_at).getTime() / 1000) : undefined,
  creator: shortAddress(battle.creator_wallet),
  opponent: battle.opponent_wallet ? shortAddress(battle.opponent_wallet) : undefined,
  winner: battle.winner_symbol,
})

export async function fetchPublicBattles() {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('battles')
    .select('*')
    .in('status', ['waiting', 'active', 'finished', 'settled'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data.map(mapBattle)
}
