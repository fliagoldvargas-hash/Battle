import { useState, useEffect } from 'react'
import { isOnchainEscrowEnabled } from '../services/onchainEscrow'
import { solanaExplorerAddress } from '../services/solanaExplorer'
import './BattleCard.css'

function formatTime(seconds) {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function BattleCard({ battle, onClick, walletAddress }) {
  const [timeLeft, setTimeLeft] = useState(0)
  const isOnchainEscrow = isOnchainEscrowEnabled()
  const networkLabel = battle.network === 'mainnet' ? 'Mainnet' : 'Devnet'

  useEffect(() => {
    if (battle.status !== 'active') return
    const calc = () => {
      const now = Math.floor(Date.now() / 1000)
      const remaining = Math.max(0, battle.endTime - now)
      setTimeLeft(remaining)
    }
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [battle])

  const statusClass = {
    waiting: 'status-waiting',
    active: 'status-active',
    finished: 'status-finished',
    settled: 'status-settled',
  }[battle.status]

  const statusLabel = {
    waiting: 'OPEN',
    active: 'LIVE',
    finished: 'FINISHED',
    settled: 'SETTLED',
  }[battle.status]

  const isUrgent = battle.status === 'active' && timeLeft < 300
  const isCreator = Boolean(walletAddress && battle.creatorAddress === walletAddress)
  const onchainBattleUrl = solanaExplorerAddress(battle.onchainBattleAddress, battle.network)

  return (
    <div
      className={`battle-card ${battle.status === 'active' ? 'active-battle' : ''} ${battle.status === 'finished' || battle.status === 'settled' ? 'finished' : ''}`}
      onClick={() => onClick?.(battle)}
    >
      <div className="battle-card-header">
        <span className={`battle-status ${statusClass}`}>
          {battle.status === 'active' && <span className="live-dot" />}
          {statusLabel}
        </span>
        {battle.status === 'active' && (
          <span className={`battle-timer ${isUrgent ? 'urgent' : ''}`}>
            {formatTime(timeLeft)}
          </span>
        )}
        {battle.status === 'waiting' && (
          <span className="battle-timer">{battle.durationLabel}</span>
        )}
      </div>

      <div className="battle-card-body">
        <div className="battle-tokens">
          <div className="battle-token token-a">
            <div className="token-symbol">{battle.tokenA.symbol}</div>
            <div className="token-mc">MC: {battle.tokenA.mc}</div>
            {!isOnchainEscrow && battle.tokenA.perf !== undefined && (
              <div className={`token-perf ${battle.tokenA.perf >= 0 ? 'perf-up' : 'perf-down'}`}>
                {battle.tokenA.perf >= 0 ? '+' : ''}{Number(battle.tokenA.perf).toFixed(4)}%
              </div>
            )}
          </div>

          <div className="battle-vs">VS</div>

          {battle.tokenB ? (
            <div className="battle-token token-b">
              <div className="token-symbol">{battle.tokenB.symbol}</div>
              <div className="token-mc">MC: {battle.tokenB.mc}</div>
              {!isOnchainEscrow && battle.tokenB.perf !== undefined && (
                <div className={`token-perf ${battle.tokenB.perf >= 0 ? 'perf-up' : 'perf-down'}`}>
                {battle.tokenB.perf >= 0 ? '+' : ''}{Number(battle.tokenB.perf).toFixed(4)}%
                </div>
              )}
            </div>
          ) : (
            <div className="battle-token open">
              <div className="open-slot">
                <span className="open-icon">+</span>
                <span>Awaiting challenger</span>
              </div>
            </div>
          )}
        </div>

        <div className="battle-card-footer">
          <div className="battle-meta">
            <div className="battle-meta-item">
              <label>Stake</label>
              <span>{battle.stake} SOL</span>
            </div>
            <div className="battle-meta-item">
              <label>Pot</label>
              <span>{battle.pot} SOL</span>
            </div>
          </div>
          {battle.status === 'waiting' ? (
            <button className="join-btn" onClick={e => { e.stopPropagation(); onClick?.(battle) }}>
              {isCreator ? 'Manage Battle →' : 'Join ⚔'}
            </button>
          ) : (
            <button className="view-btn" onClick={e => { e.stopPropagation(); onClick?.(battle) }}>View →</button>
          )}
        </div>
        {isOnchainEscrow && battle.status === 'active' && (
          <p className="devnet-card-note">Escrow funded on {networkLabel} · oracle settlement runs automatically after the battle ends</p>
        )}
        {onchainBattleUrl && (
          <a
            className="onchain-card-link"
            href={onchainBattleUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            aria-label="View this battle on Solana Explorer"
          >
            View on-chain ↗
          </a>
        )}
      </div>
    </div>
  )
}
