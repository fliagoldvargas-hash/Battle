import { useEffect, useState } from 'react'
import { CrownMark, Icon } from './BrandMark'
import './BattleCard.css'

function formatTime(seconds) {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const statusLabels = { waiting: 'Open', active: 'Live', finished: 'Finished', settled: 'Settled' }

function TokenSide({ token, waiting }) {
  if (waiting) return <div className="battle-token open"><span className="open-slot-icon">+</span><strong>Open slot</strong><small>Awaiting challenger</small></div>
  return (
    <div className="battle-token">
      <span className="battle-token-mark">{token.symbol?.replace('$', '').slice(0, 1) || '?'}</span>
      <div><strong>{token.symbol}</strong><small>MC {token.mc ?? '—'}</small></div>
      {token.perf !== undefined ? <b className={`mono ${token.perf >= 0 ? 'perf-up' : 'perf-down'}`}>{token.perf >= 0 ? '+' : ''}{Number(token.perf).toFixed(2)}%</b> : <b className="mono neutral-perf">—</b>}
    </div>
  )
}

export default function BattleCard({ battle, onClick }) {
  const [timeLeft, setTimeLeft] = useState(0)

  useEffect(() => {
    if (battle.status !== 'active') return undefined
    const calc = () => setTimeLeft(Math.max(0, battle.endTime - Math.floor(Date.now() / 1000)))
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [battle.endTime, battle.status])

  const urgent = battle.status === 'active' && timeLeft < 300
  return (
    <article className={`battle-card status-${battle.status}`}>
      <button className="battle-card-hit" onClick={() => onClick?.(battle)} aria-label={`View ${battle.tokenA.symbol} versus ${battle.tokenB?.symbol ?? 'open slot'} battle`} />
      <div className="battle-card-topline">
        <span className={`battle-status status-${battle.status}`}><span className="status-symbol" />{statusLabels[battle.status] ?? 'Needs review'}</span>
        <span className={`battle-time mono ${urgent ? 'urgent' : ''}`}><Icon name="timer" size={15} />{battle.status === 'active' ? formatTime(timeLeft) : battle.durationLabel}</span>
      </div>
      <div className="battle-matchup">
        <TokenSide token={battle.tokenA} />
        <div className="battle-vs"><CrownMark size={25} title="" /><span>VS</span></div>
        <TokenSide token={battle.tokenB} waiting={!battle.tokenB} />
      </div>
      <div className="battle-card-bottom">
        <div className="battle-metrics"><span>Stake <b className="mono">{battle.stake} SOL</b></span><span>Pot <b className="mono">{battle.pot} SOL</b></span></div>
        <button className={battle.status === 'waiting' ? 'join-btn' : 'view-btn'} onClick={(event) => { event.stopPropagation(); onClick?.(battle) }}>
          {battle.status === 'waiting' ? 'Join battle' : 'View battle'} <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </article>
  )
}
