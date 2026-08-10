import { supabase } from '../lib/supabase'

const LAMPORTS_PER_SOL = 1_000_000_000

const shortAddress = (address) => address ? `${address.slice(0, 8)}...${address.slice(-4)}` : 'Unknown'

export async function fetchBattleRows() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('battles')
    .select('*')
    .in('status', ['waiting', 'active', 'finished', 'settled'])
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data ?? []
}

export async function fetchWalletStats(walletAddress) {
  const rows = (await fetchBattleRows()).filter((battle) => (
    battle.creator_wallet === walletAddress || battle.opponent_wallet === walletAddress
  ))
  const finished = rows.filter((battle) => ['finished', 'settled'].includes(battle.status))
  const wins = finished.filter((battle) => (
    (battle.winner_mint === battle.token_a_mint && battle.creator_wallet === walletAddress)
    || (battle.winner_mint === battle.token_b_mint && battle.opponent_wallet === walletAddress)
  )).length
  const stakedLamports = rows.reduce((sum, battle) => sum + Number(battle.stake_lamports || 0), 0)
  const totalWonLamports = finished.reduce((sum, battle) => {
    const winner = (
      (battle.winner_mint === battle.token_a_mint && battle.creator_wallet === walletAddress)
      || (battle.winner_mint === battle.token_b_mint && battle.opponent_wallet === walletAddress)
    )
    if (winner) return sum + Number(battle.pot_lamports || 0)
    if (!battle.winner_mint && (battle.creator_wallet === walletAddress || battle.opponent_wallet === walletAddress)) {
      return sum + Number(battle.stake_lamports || 0)
    }
    return sum
  }, 0)

  return {
    totalBattles: rows.length,
    wins,
    losses: Math.max(0, finished.length - wins),
    winRate: finished.length ? (wins / finished.length) * 100 : 0,
    totalStaked: stakedLamports / LAMPORTS_PER_SOL,
    totalWon: totalWonLamports / LAMPORTS_PER_SOL,
    history: finished.map((battle) => ({
      id: battle.id,
      tokens: `${battle.token_a_symbol} vs ${battle.token_b_symbol || '—'}`,
      perf: `${battle.token_a_change_pct == null ? '—' : `${Number(battle.token_a_change_pct).toFixed(2)}%`} vs ${battle.token_b_change_pct == null ? '—' : `${Number(battle.token_b_change_pct).toFixed(2)}%`}`,
      result: !battle.winner_mint ? 'draw' : (
        (battle.winner_mint === battle.token_a_mint && battle.creator_wallet === walletAddress)
        || (battle.winner_mint === battle.token_b_mint && battle.opponent_wallet === walletAddress)
      ) ? 'win' : 'loss',
      amount: !battle.winner_mint
        ? `+${(Number(battle.stake_lamports || 0) / LAMPORTS_PER_SOL).toFixed(2)} SOL`
        : (
          (battle.winner_mint === battle.token_a_mint && battle.creator_wallet === walletAddress)
          || (battle.winner_mint === battle.token_b_mint && battle.opponent_wallet === walletAddress)
        )
          ? `+${(Number(battle.pot_lamports || 0) / LAMPORTS_PER_SOL).toFixed(2)} SOL`
          : `-${(Number(battle.stake_lamports || 0) / LAMPORTS_PER_SOL).toFixed(2)} SOL`,
    })),
  }
}

export async function fetchLeaderboard() {
  const rows = await fetchBattleRows()
  const players = new Map()
  const ensure = (address) => {
    if (!address) return null
    if (!players.has(address)) players.set(address, { address, wins: 0, battles: 0, staked: 0 })
    return players.get(address)
  }

  for (const battle of rows) {
    const creator = ensure(battle.creator_wallet)
    const opponent = ensure(battle.opponent_wallet)
    for (const player of [creator, opponent]) {
      if (player) {
        player.battles += 1
        player.staked += Number(battle.stake_lamports || 0) / LAMPORTS_PER_SOL
      }
    }
    if (battle.status === 'finished' || battle.status === 'settled') {
      if (battle.winner_mint === battle.token_a_mint && creator) creator.wins += 1
      if (battle.winner_mint === battle.token_b_mint && opponent) opponent.wins += 1
    }
  }

  return [...players.values()]
    .sort((a, b) => b.wins - a.wins || b.staked - a.staked)
    .map((player, index) => ({
      rank: index + 1,
      player: shortAddress(player.address),
      wins: player.wins,
      rate: player.battles ? `${((player.wins / player.battles) * 100).toFixed(1)}%` : '0.0%',
      staked: `${player.staked.toFixed(2)} SOL`,
    }))
}

export async function fetchPlatformStats() {
  const rows = await fetchBattleRows()
  return {
    battles: rows.length,
    volume: rows.reduce((sum, battle) => sum + Number(battle.pot_lamports || 0), 0) / LAMPORTS_PER_SOL,
    warriors: new Set(rows.flatMap((battle) => [battle.creator_wallet, battle.opponent_wallet].filter(Boolean))).size,
  }
}
