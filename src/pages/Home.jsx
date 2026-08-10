import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchPlatformStats } from '../services/analytics'
import './Home.css'

export default function Home() {
  const navigate = useNavigate()
  const [perfA, setPerfA] = useState(42.7)
  const [perfB, setPerfB] = useState(31.2)
  const [stats, setStats] = useState(null)
  const particles = useMemo(() => Array.from({ length: 20 }, () => ({
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 5}s`,
    animationDuration: `${3 + Math.random() * 4}s`,
    width: `${2 + Math.random() * 4}px`,
    height: `${2 + Math.random() * 4}px`,
  })), [])

  // Simulate live performance changes
  useEffect(() => {
    const interval = setInterval(() => {
      setPerfA(prev => +(prev + (Math.random() - 0.45) * 2).toFixed(1))
      setPerfB(prev => +(prev + (Math.random() - 0.55) * 2).toFixed(1))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetchPlatformStats().then(setStats).catch(() => {})
  }, [])

  return (
    <section className="hero">
      <div className="hero-bg" />
      <div className="hero-grid" />

      {/* Floating particles */}
      <div className="hero-particles">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="particle"
            style={particle}
          />
        ))}
      </div>

      <div className="hero-content">
        <div className="hero-eyebrow">
          <span className="live-dot" />
          Live on Solana — Pump.fun Tokens
        </div>

        <h1 className="hero-title">
          PICK A TOKEN.
          <br />
          <span className="t-violet">STAKE SOL.</span>
          <br />
          <span className="t-pink">WIN THE POT.</span>
        </h1>

        <p className="hero-sub">
          1v1 battles where two Pump.fun tokens compete by percentage performance.
          The smarter pick takes everything.
        </p>

        <div className="hero-vs-demo">
          <div className="hero-token-card">
            <div className="hero-token-icon">🐸</div>
            <div className="hero-token-symbol">$PEPE2</div>
            <div className={`hero-token-perf ${perfA >= 0 ? 'perf-up' : 'perf-down'}`}>
              {perfA >= 0 ? '+' : ''}{perfA.toFixed(1)}%
            </div>
          </div>

          <div className="vs-badge-container">
            <div className="vs-ring" />
            <div className="vs-ring ring-2" />
            <span className="vs-badge">VS</span>
          </div>

          <div className="hero-token-card right">
            <div className="hero-token-icon">🐕</div>
            <div className="hero-token-symbol">$DOGE3</div>
            <div className={`hero-token-perf ${perfB >= 0 ? 'perf-up' : 'perf-down'}`}>
              {perfB >= 0 ? '+' : ''}{perfB.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="hero-cta">
          <button className="btn-primary" onClick={() => navigate('/battles')}>
            ⚔ Create Battle
          </button>
          <button className="btn-secondary" onClick={() => navigate('/battles')}>
            Browse Battles
          </button>
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value">{stats?.battles ?? '—'}</span>
            <span className="hero-stat-label">Battles Created</span>
          </div>
          <div className="hero-stat-divider" />
          <div className="hero-stat">
            <span className="hero-stat-value">{stats ? `${stats.volume.toFixed(2)} SOL` : '—'}</span>
            <span className="hero-stat-label">Total Volume</span>
          </div>
          <div className="hero-stat-divider" />
          <div className="hero-stat">
            <span className="hero-stat-value">{stats?.warriors ?? '—'}</span>
            <span className="hero-stat-label">Active Warriors</span>
          </div>
        </div>
      </div>
    </section>
  )
}
