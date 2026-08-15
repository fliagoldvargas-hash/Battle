import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useWallet } from '../context/useWallet'
import { CrownMark, Icon } from './BrandMark'
import './Navbar.css'

const navItems = [
  { path: '/battles', label: 'Arena', icon: 'arena' },
  { path: '/leaderboard', label: 'Leaderboard', icon: 'chart' },
  { path: '/profile', label: 'Profile', icon: 'profile' },
  { path: '/contract', label: 'Protocol', icon: 'protocol' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const { wallet, connect, disconnect, isReady } = useWallet()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!mobileOpen) return undefined
    const close = (event) => event.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [mobileOpen])

  const handleWallet = async () => {
    if (!wallet.connected) {
      connect()
      return
    }
    await disconnect()
  }

  const openCreate = () => {
    navigate('/battles?create=1')
    setMobileOpen(false)
  }

  return (
    <header className="navbar-shell">
      <nav className="navbar" aria-label="Primary navigation">
        <button className="nav-logo" onClick={() => navigate('/')} aria-label="FLIPPEN home">
          <CrownMark size={34} />
          <span className="nav-logo-text">FLIPPEN</span>
        </button>

        <div className={`nav-panel ${mobileOpen ? 'open' : ''}`} id="primary-menu">
          <div className="nav-links">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </NavLink>
            ))}
          </div>

          <div className="nav-actions">
            <button className="nav-create-btn" onClick={openCreate}>
              <span>Create Battle</span>
              <Icon name="arrowRight" size={17} />
            </button>
            <button
              className={`wallet-btn ${wallet.connected ? 'connected' : ''}`}
              onClick={handleWallet}
              disabled={!isReady}
              title={wallet.connected ? wallet.address : 'Connect wallet'}
            >
              <Icon name="wallet" size={17} />
              <span>{wallet.connected ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}` : isReady ? 'Connect' : 'Loading'}</span>
            </button>
          </div>
        </div>

        <button
          className={`mobile-toggle ${mobileOpen ? 'open' : ''}`}
          onClick={() => setMobileOpen((current) => !current)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="primary-menu"
        >
          <span /><span /><span />
        </button>
      </nav>
    </header>
  )
}
