const LAMPORTS_PER_SOL = 1_000_000_000
const NETWORK = import.meta.env.VITE_BATTLE_NETWORK === 'devnet' ? 'devnet' : 'mainnet'

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
  creatorAddress: battle.creator_wallet,
  opponent: battle.opponent_wallet ? shortAddress(battle.opponent_wallet) : undefined,
  opponentAddress: battle.opponent_wallet,
  winner: battle.winner_symbol,
  network: battle.network ?? NETWORK,
  onchainBattleId: battle.onchain_battle_id,
  onchainBattleAddress: battle.onchain_battle_address,
  vaultAddress: battle.vault_address,
  creatorDepositSignature: battle.creator_deposit_signature,
  opponentDepositSignature: battle.opponent_deposit_signature,
  settlementSignature: battle.settlement_signature,
  escrowState: battle.escrow_state,
})

export async function fetchPublicBattles() {
  const response = await fetch('/api/battles')
  const result = await response.json().catch(() => ({}))
  if (response.ok) return (result.battles ?? []).map(mapBattle)
  if (!supabase) throw new Error(result.error || 'Unable to load battles.')
  const { data, error } = await supabase
    .from('battles')
    .select('*')
    .eq('network', NETWORK)
    .in('status', ['waiting', 'active', 'finished', 'settled'])
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map(mapBattle)
}
import { supabase } from '../lib/supabase'
