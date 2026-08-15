import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '../services/analytics'
import { notify } from '../components/notificationService'
import { CrownMark } from '../components/BrandMark'
import './Leaderboard.css'

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([])

  useEffect(() => {
    fetchLeaderboard()
      .then(setLeaderboard)
      .catch((error) => notify('error', 'Leaderboard Unavailable', error.message))
  }, [])

  const getRankClass = (rank) => {
    if (rank === 1) return 'gold'
    if (rank === 2) return 'silver'
    if (rank === 3) return 'bronze'
    return ''
  }

  return (
    <section className="page-shell leaderboard-section">
      <div className="page-header">
        <p className="page-kicker">The crown table</p>
        <h1 className="page-title">Top of the arena.</h1>
        <p className="page-subtitle">Ranked by real wins and win rate across settled FLIPPEN battles.</p>
      </div>

      <div className="leaderboard-container">
        <div className="podium">
          {leaderboard.slice(0, 3).map(entry => (
            <div key={entry.rank} className={`podium-card podium-${entry.rank}`}>
              <div className="podium-medal">{entry.rank === 1 ? <CrownMark size={58} /> : <span className="mono">#{entry.rank}</span>}</div>
              <div className="podium-rank-badge">RANK {entry.rank}</div>
              <div className="podium-player">{entry.player}</div>
              <div className="podium-stats">
                <div className="podium-stat">
                  <span className="podium-stat-value">{entry.wins}</span>
                  <span className="podium-stat-label">Wins</span>
                </div>
                <div className="podium-stat">
                  <span className="podium-stat-value green">{entry.rate}</span>
                  <span className="podium-stat-label">Rate</span>
                </div>
              </div>
              <div className="podium-staked">{entry.staked} staked</div>
            </div>
          ))}
        </div>

        <div className="leaderboard-table">
          <div className="lb-header">
            <div>#</div>
            <div>Player</div>
            <div>Wins</div>
            <div>Win Rate</div>
            <div className="lb-staked-col">Staked</div>
          </div>
          {leaderboard.map((entry, i) => (
            <div
              key={entry.rank}
              className="lb-row animate-in"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className={`lb-rank ${getRankClass(entry.rank)}`}>
                #{entry.rank}
              </div>
              <div className="lb-player">{entry.player}</div>
              <div className="lb-wins">{entry.wins}</div>
              <div className="lb-rate">{entry.rate}</div>
              <div className="lb-staked">{entry.staked}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
