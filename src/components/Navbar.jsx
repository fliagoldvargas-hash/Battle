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
  const { wallet, connect, disconnect } = useWallet()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleWallet = () => {
    if (wallet.connected) {
      disconnect()
    } else {
      connect()
    }
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
      >
        {wallet.connected ? (
          <>
            <span className="wallet-dot" />
            {wallet.address.slice(0, 4)}...{wallet.address.slice(-4)}
          </>
        ) : (
          'Connect Wallet'
        )}
      </button>
    </nav>
  )
}
