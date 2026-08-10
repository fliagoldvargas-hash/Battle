import { useCallback, useEffect, useMemo, useState } from 'react'
import BattleCard from '../components/BattleCard'
import Modal from '../components/Modal'
import { DURATIONS } from '../data/mockData'
import { useWallet } from '../context/useWallet'
import { notify } from '../components/notificationService'
import { fetchPublicBattles } from '../services/battles'
import { createBattle, joinBattle } from '../services/battleActions'
import { lookupPumpFunToken } from '../services/pumpfunTokens'
import './Battles.css'

export default function Battles() {
  const { wallet, getAccessToken, depositStake, escrowConfigured } = useWallet()
  const [battles, setBattles] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [viewBattle, setViewBattle] = useState(null)
  const [selectedDuration, setSelectedDuration] = useState(3600)
  const [stakeAmount, setStakeAmount] = useState('5')
  const [selectedToken, setSelectedToken] = useState(null)
  const [tokenAddress, setTokenAddress] = useState('')
  const [joinToken, setJoinToken] = useState(null)
  const [joinTokenAddress, setJoinTokenAddress] = useState('')
  const [isLookingUpToken, setIsLookingUpToken] = useState(false)
  const [isLookingUpJoinToken, setIsLookingUpJoinToken] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const refreshBattles = useCallback(async () => {
    const remoteBattles = await fetchPublicBattles()
    setBattles(remoteBattles ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const remoteBattles = await fetchPublicBattles()
        if (!cancelled) setBattles(remoteBattles ?? [])
      } catch (error) {
        if (!cancelled) notify('error', 'Battles Unavailable', error.message)
      }
    }

    void load()
    const interval = setInterval(() => {
      void refreshBattles().catch(() => {})
    }, 30_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refreshBattles])

  const filteredBattles = useMemo(() => {
    let list = [...battles]
    if (filter !== 'all') list = list.filter(b => b.status === filter)
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(b =>
        b.tokenA.symbol.toLowerCase().includes(s) ||
        (b.tokenB && b.tokenB.symbol.toLowerCase().includes(s))
      )
    }
    return list
  }, [battles, filter, search])

  const [currentTime, setCurrentTime] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (viewBattle?.status !== 'active') return undefined

    const interval = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [viewBattle?.status])

  const loadToken = async (address, setToken, setLoading) => {
    if (!address.trim()) {
      setToken(null)
      return null
    }

    setLoading(true)
    try {
      const token = await lookupPumpFunToken(address)
      setToken(token)
      return token
    } catch (error) {
      setToken(null)
      notify('error', 'Token Not Found', error.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  const formatMarketCap = (marketCap) => {
    if (!Number.isFinite(marketCap)) return 'MC unavailable'
    if (marketCap >= 1_000_000_000) return `MC $${(marketCap / 1_000_000_000).toFixed(2)}B`
    if (marketCap >= 1_000_000) return `MC $${(marketCap / 1_000_000).toFixed(2)}M`
    if (marketCap >= 1_000) return `MC $${(marketCap / 1_000).toFixed(1)}K`
    return `MC $${marketCap.toFixed(0)}`
  }

  const handleCreate = async () => {
    if (!wallet.connected) {
      notify('error', 'Wallet Required', 'Please connect your wallet first')
      return
    }
    const stake = Number(stakeAmount)
    const token = selectedToken ?? await loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)
    if (!token || !Number.isFinite(stake) || stake < 0.1) {
      notify('error', 'Invalid Battle', 'Enter a valid Pump.fun CA and a stake of at least 0.1 SOL')
      return
    }

    setIsSubmitting(true)
    try {
      const depositSignature = escrowConfigured
        ? await depositStake(Math.round(stake * 1_000_000_000))
        : null
      const newBattle = await createBattle({
        getAccessToken,
        walletAddress: wallet.address,
        token: { mint: token.mint },
        stakeSol: stake,
        durationSeconds: selectedDuration,
        depositSignature,
      })
      setBattles(currentBattles => [newBattle, ...currentBattles])
      notify('success', 'Battle Created!', `${token.symbol} battle was saved`)
      setCreateOpen(false)
      setSelectedToken(null)
      setTokenAddress('')
      setStakeAmount('5')
    } catch (error) {
      notify('error', 'Battle Not Created', error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openBattle = (battle) => {
    setViewBattle(battle)
    setJoinToken(null)
    setJoinTokenAddress('')
  }

  const handleJoin = async () => {
    if (!wallet.connected) {
      notify('error', 'Wallet Required', 'Please connect your wallet before joining a battle')
      return
    }
    const token = joinToken ?? await loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)
    if (!token) {
      notify('error', 'Token Required', 'Enter a valid Pump.fun contract address')
      return
    }

    setIsSubmitting(true)
    try {
      const depositSignature = escrowConfigured
        ? await depositStake(Math.round(Number(viewBattle.stake) * 1_000_000_000))
        : null
      const joinedBattle = await joinBattle({
        getAccessToken,
        walletAddress: wallet.address,
        battleId: viewBattle.id,
        token: { mint: token.mint },
        depositSignature,
      })
      setBattles(currentBattles => currentBattles.map(battle => battle.id === joinedBattle.id ? joinedBattle : battle))
      notify('success', 'Joined Battle!', `You joined against ${viewBattle.tokenA.symbol}`)
      setViewBattle(null)
    } catch (error) {
      notify('error', 'Could Not Join', error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatTime = (seconds) => {
    if (seconds <= 0) return '00:00:00'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <section className="battles-section">
      <div className="page-header">
        <h1 className="page-title">⚔ Battles</h1>
        <p className="page-subtitle">Browse open battles or create your own challenge</p>
      </div>

      <div className="battles-container">
        <div className="battles-toolbar">
          <div className="filter-group">
            {['all', 'waiting', 'active', 'finished'].map(f => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'active' && <span className="live-dot" />}
                {f === 'all' ? 'All' : f === 'waiting' ? 'Open' : f === 'active' ? 'Live' : 'Finished'}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="search-box"
            placeholder="Search token..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="create-battle-btn" onClick={() => setCreateOpen(true)}>
            + Create Battle
          </button>
        </div>

        {filteredBattles.length > 0 ? (
          <div className="battles-grid">
            {filteredBattles.map((battle, i) => (
              <div key={battle.id} className="animate-in" style={{ animationDelay: `${i * 0.08}s` }}>
                <BattleCard battle={battle} onClick={openBattle} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">⚔</div>
            <div className="empty-title">No battles found</div>
            <p className="empty-text">Try a different filter or create a new battle!</p>
          </div>
        )}
      </div>

      {/* Create Battle Modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="⚔ Create Battle">
        <div className="form-group">
          <label className="form-label">Your Token</label>
          <div className="form-input-wrap">
            <input
              type="text"
              className="form-input"
              placeholder="Paste a Pump.fun contract address (CA)..."
              value={tokenAddress}
              onChange={e => {
                setTokenAddress(e.target.value)
                setSelectedToken(null)
              }}
              onBlur={() => loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)
                }
              }}
            />
          </div>
          {isLookingUpToken && <p className="form-hint">Checking Pump.fun...</p>}
          {selectedToken && <p className="form-hint">Verified: {selectedToken.name} (${selectedToken.symbol}) · {formatMarketCap(selectedToken.marketCap)}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">Battle Duration</label>
          <div className="duration-grid">
            {DURATIONS.map(d => (
              <div
                key={d.value}
                className={`duration-option ${selectedDuration === d.value ? 'selected' : ''}`}
                onClick={() => setSelectedDuration(d.value)}
              >
                <div className="dur-time">{d.time}</div>
                <div className="dur-label">{d.unit}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Stake Amount (SOL)</label>
          <input
            type="number"
            className="form-input"
            placeholder="Enter SOL amount..."
            value={stakeAmount}
            onChange={e => setStakeAmount(e.target.value)}
            min="0.1"
            step="0.1"
          />
        </div>

        <div className="stake-display">
          <span className="stake-display-label">Total Pot (when matched)</span>
          <span className="stake-display-value">{(parseFloat(stakeAmount || 0) * 2).toFixed(1)} SOL</span>
        </div>

        <button className="form-submit" onClick={handleCreate} disabled={isSubmitting}>
          {isSubmitting ? 'SAVING...' : '⚔ CREATE BATTLE'}
        </button>
      </Modal>

      {/* View Battle Modal */}
      <Modal
        isOpen={!!viewBattle}
        onClose={() => setViewBattle(null)}
        title={viewBattle ? `${viewBattle.tokenA.symbol} vs ${viewBattle.tokenB?.symbol || '???'}` : ''}
        size="wide"
      >
        {viewBattle && (
          <>
            <div className="battle-vs-display">
              <div className="bvd-side a">
                <div className="bvd-symbol">{viewBattle.tokenA.symbol}</div>
                {viewBattle.tokenA.perf !== undefined && (
                  <div className={`bvd-perf ${viewBattle.tokenA.perf >= 0 ? 'perf-up' : 'perf-down'}`}>
                    {viewBattle.tokenA.perf >= 0 ? '+' : ''}{viewBattle.tokenA.perf}%
                  </div>
                )}
                <div className="bvd-mc">MC: {viewBattle.tokenA.mc}</div>
                <div className="bvd-player">{viewBattle.creator}</div>
              </div>

              <div className="bvd-center">
                <div className="bvd-vs-text">VS</div>
                {viewBattle.status === 'active' && (
                  <div className="bvd-timer-big">
                    {formatTime(Math.max(0, viewBattle.endTime - currentTime))}
                  </div>
                )}
              </div>

              <div className="bvd-side b">
                {viewBattle.tokenB ? (
                  <>
                    <div className="bvd-symbol">{viewBattle.tokenB.symbol}</div>
                    {viewBattle.tokenB.perf !== undefined && (
                      <div className={`bvd-perf ${viewBattle.tokenB.perf >= 0 ? 'perf-up' : 'perf-down'}`}>
                        {viewBattle.tokenB.perf >= 0 ? '+' : ''}{viewBattle.tokenB.perf}%
                      </div>
                    )}
                    <div className="bvd-mc">MC: {viewBattle.tokenB.mc}</div>
                    <div className="bvd-player">{viewBattle.opponent}</div>
                  </>
                ) : (
                  <div className="bvd-waiting">Awaiting<br/>Challenger</div>
                )}
              </div>
            </div>

            <div className="battle-info-row">
              <div className="battle-info-item">
                <label>Stake</label>
                <span>{viewBattle.stake} SOL</span>
              </div>
              <div className="battle-info-item">
                <label>Total Pot</label>
                <span>{viewBattle.pot} SOL</span>
              </div>
              <div className="battle-info-item">
                <label>Duration</label>
                <span>{viewBattle.durationLabel}</span>
              </div>
            </div>

            {viewBattle.status === 'active' && viewBattle.tokenA.perf !== undefined && viewBattle.tokenB?.perf !== undefined && (
              <>
                <div className="progress-bar-wrap">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${Math.min(100, Math.max(5, 50 + (viewBattle.tokenA.perf - viewBattle.tokenB.perf)))}%`
                    }}
                  />
                </div>
                <div className="leader-badge">
                  🏆 {viewBattle.tokenA.perf > viewBattle.tokenB.perf ? viewBattle.tokenA.symbol : viewBattle.tokenB.symbol} IS LEADING
                </div>
              </>
            )}

            {viewBattle.status === 'waiting' && (
              <>
                <div className="form-group">
                  <label className="form-label">Your Token</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Paste a Pump.fun contract address (CA)..."
                    value={joinTokenAddress}
                    onChange={event => {
                      setJoinTokenAddress(event.target.value)
                      setJoinToken(null)
                    }}
                    onBlur={() => loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)
                      }
                    }}
                  />
                  {isLookingUpJoinToken && <p className="form-hint">Checking Pump.fun...</p>}
                  {joinToken && <p className="form-hint">Verified: {joinToken.name} (${joinToken.symbol}) · {formatMarketCap(joinToken.marketCap)}</p>}
                </div>
                <button className="form-submit" onClick={handleJoin} disabled={isSubmitting}>
                  {isSubmitting ? 'SAVING...' : `⚔ JOIN BATTLE (${viewBattle.stake} SOL)`}
                </button>
              </>
            )}

            {(viewBattle.status === 'finished' || viewBattle.status === 'settled') && viewBattle.winner && (
              <div className="result-section">
                <div className="result-trophy">🏆</div>
                <div className="result-winner-label">WINNER</div>
                <div className="result-winner-token">{viewBattle.winner}</div>
              </div>
            )}
          </>
        )}
      </Modal>
    </section>
  )
}
