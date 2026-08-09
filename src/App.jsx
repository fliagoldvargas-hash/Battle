import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import NotificationContainer from './components/Notification'
import Home from './pages/Home'
import Battles from './pages/Battles'
import Profile from './pages/Profile'
import Leaderboard from './pages/Leaderboard'
import Contract from './pages/Contract'

function App() {
  return (
    <Router>
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/battles" element={<Battles />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/contract" element={<Contract />} />
        </Routes>
      </main>
      <NotificationContainer />
    </Router>
  )
}

export default App
