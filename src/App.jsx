import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import NotificationContainer from './components/Notification'
import Home from './pages/Home'
import Battles from './pages/Battles'
import Profile from './pages/Profile'
import Leaderboard from './pages/Leaderboard'
import Contract from './pages/Contract'
import './App.css'

function App() {
  return (
    <Router>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Navbar />
      <main id="main-content" className="app-main" tabIndex="-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/battles" element={<Battles />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/contract" element={<Contract />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>FLIPPEN</span>
        <span>On-chain trading battles on Solana.</span>
      </footer>
      <NotificationContainer />
    </Router>
  )
}

export default App
