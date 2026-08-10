import { useEffect, useState } from 'react'
import { useWallet } from '../context/useWallet'
import { fetchWalletStats } from '../services/analytics'
import { notify } from '../components/notificationService'
import './Profile.css'

export default function Profile() {
  const { wallet } = useWallet()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!wallet.connected) return undefined
    let cancelled = false
    fetchWalletStats(wallet.address)
      .then((result) => { if (!cancelled) setStats(result) })
      .catch((error) => notify('error', 'Profile Unavailable', error.message))
    return () => { cancelled = true }
  }, [wallet.address, wallet.connected])

  if (!wallet.connected) {
    return (
      <section className="profile-section">
        <div className="page-header">
          <h1 className="page-title">👤 Profile</h1>
          <p className="page-subtitle">Your battle statistics and history</p>
        </div>
        <div className="profile-container">
          <div className="empty-state">
            <div className="empty-icon">🔌</div>
            <div className="empty-title">Connect your wallet to view profile</div>
            <p className="empty-text">Your stats and battle history will appear here.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="profile-section">
      <div className="page-header">
        <h1 className="page-title">👤 Profile</h1>
        <p className="page-subtitle">Your battle statistics and history</p>
      </div>

      <div className="profile-container">
        <div className="profile-card animate-in">
          <div className="profile-header">
            <div className="profile-avatar">
              {wallet.address.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="profile-address">
                {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
              </div>
              <div className="profile-since">Battle Warrior since August 2026</div>
            </div>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value violet">{stats?.totalBattles ?? '—'}</div>
              <div className="stat-label">Total Battles</div>
            </div>
            <div className="stat-card">
              <div className="stat-value green">{stats?.wins ?? '—'}</div>
              <div className="stat-label">Wins</div>
            </div>
            <div className="stat-card">
              <div className="stat-value red">{stats?.losses ?? '—'}</div>
              <div className="stat-label">Losses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value gold">{stats ? `${stats.winRate.toFixed(1)}%` : '—'}</div>
              <div className="stat-label">Win Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value violet">{stats ? `${stats.totalStaked.toFixed(2)} SOL` : '—'}</div>
              <div className="stat-label">Total Staked</div>
            </div>
            <div className="stat-card">
              <div className="stat-value green">{stats ? `${stats.totalWon.toFixed(2)} SOL` : '—'}</div>
              <div className="stat-label">Total Won</div>
            </div>
          </div>
        </div>

        <div className="profile-card animate-in stagger-2">
          <h3 className="section-heading">Battle History</h3>
          <div className="history-list">
            {(stats?.history ?? []).map((item, i) => (
              <div
                key={item.id}
                className="history-item animate-in"
                style={{ animationDelay: `${0.3 + i * 0.08}s` }}
              >
                <div className="history-tokens">{item.tokens}</div>
                <div className="history-perf">{item.perf}</div>
                <div className={`history-result result-${item.result}`}>
                  {item.result.toUpperCase()}
                </div>
                <div className={`history-amount ${item.result === 'win' ? 'green' : 'red'}`}>
                  {item.amount}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
