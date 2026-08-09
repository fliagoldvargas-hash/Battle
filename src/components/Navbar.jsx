import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useWallet } from '../context/useWallet'
import './Navbar.css'

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/battles', label: 'Battles' },
  { path: '/leaderboard', label: 'Leaderboard' },
  { path: '/profile', label: 'Profile' },
  { path: '/contract', label: 'Contract' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { wallet, connect, disconnect, isReady } = useWallet()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleWallet = async () => {
    if (!wallet.connected) {
      connect()
      return
    }

    await disconnect()
  }

  return (
    <nav className="navbar">
      <div className="nav-logo" onClick={() => navigate('/')}>
        <span className="nav-logo-icon">⚔</span>
        <span className="nav-logo-text">TOKEN BATTLE</span>
      </div>

      <button
        className={`mobile-toggle ${mobileOpen ? 'open' : ''}`}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <span /><span /><span />
      </button>

      <div className={`nav-links ${mobileOpen ? 'open' : ''}`}>
        {navItems.map(item => (
          <a
            key={item.path}
            className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => { navigate(item.path); setMobileOpen(false) }}
          >
            {item.label}
          </a>
        ))}
      </div>

      <button
        className={`wallet-btn ${wallet.connected ? 'connected' : ''}`}
        onClick={handleWallet}
        disabled={!isReady}
        title={wallet.connected ? 'Disconnect wallet' : 'Connect wallet'}
      >
        {wallet.connected ? (
          <>
            <span className="wallet-dot" />
            Disconnect Wallet
          </>
        ) : (
          isReady ? 'Connect Wallet' : 'Loading Wallet...'
        )}
      </button>
    </nav>
  )
}
