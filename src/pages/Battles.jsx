import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import BattleCard from '../components/BattleCard'
import Modal from '../components/Modal'
import { CrownMark, Icon } from '../components/BrandMark'
import { DURATIONS } from '../data/mockData'
import { useWallet } from '../context/useWallet'
import { notify } from '../components/notificationService'
import { fetchPublicBattles } from '../services/battles'
import { createBattle, joinBattle } from '../services/battleActions'
import { lookupPumpFunToken } from '../services/pumpfunTokens'
import './Battles.css'

gsap.registerPlugin(useGSAP)
const PLATFORM_FEE_RATE = 0.0025
const filterLabels = { all: 'All', waiting: 'Open', active: 'Live', finished: 'Finished' }

export default function Battles() {
  const { wallet, getAccessToken, depositStake, escrowConfigured } = useWallet()
  const [searchParams, setSearchParams] = useSearchParams()
  const pageRef = useRef(null)
  const [battles, setBattles] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1')
  const [createStep, setCreateStep] = useState(1)
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
  const [currentTime, setCurrentTime] = useState(() => Math.floor(Date.now() / 1000))

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
        if (!cancelled) notify('error', 'Battles unavailable', error.message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    const interval = setInterval(() => void refreshBattles().catch(() => {}), 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [refreshBattles])

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (viewBattle?.status !== 'active') return undefined
    const interval = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [viewBattle?.status])

  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.battle-grid-item', { autoAlpha: 0, y: 18, stagger: .045, duration: .35, ease: 'power2.out' })
    })
    return () => mm.revert()
  }, { scope: pageRef, dependencies: [filter, battles.length], revertOnUpdate: true })

  const filteredBattles = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return battles.filter((battle) => {
      const matchesStatus = filter === 'all' || battle.status === filter
      const matchesSearch = !normalized || battle.tokenA.symbol.toLowerCase().includes(normalized) || battle.tokenB?.symbol.toLowerCase().includes(normalized)
      return matchesStatus && matchesSearch
    })
  }, [battles, filter, search])

  const loadToken = async (address, setToken, setLoading) => {
    if (!address.trim()) { setToken(null); return null }
    setLoading(true)
    try {
      const token = await lookupPumpFunToken(address)
      setToken(token)
      return token
    } catch (error) {
      setToken(null)
      notify('error', 'Token not found', error.message)
      return null
    } finally { setLoading(false) }
  }

  const formatMarketCap = (marketCap) => {
    if (!Number.isFinite(marketCap)) return 'Unavailable'
    if (marketCap >= 1_000_000_000) return `$${(marketCap / 1_000_000_000).toFixed(2)}B`
    if (marketCap >= 1_000_000) return `$${(marketCap / 1_000_000).toFixed(2)}M`
    if (marketCap >= 1_000) return `$${(marketCap / 1_000).toFixed(1)}K`
    return `$${marketCap.toFixed(0)}`
  }

  const formatTime = (seconds) => {
    if (seconds <= 0) return '00:00:00'
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const closeCreate = () => {
    setCreateOpen(false)
    setCreateStep(1)
    if (searchParams.has('create')) { const next = new URLSearchParams(searchParams); next.delete('create'); setSearchParams(next, { replace: true }) }
  }

  const advanceFromToken = async () => {
    const token = selectedToken ?? await loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)
    if (token) setCreateStep(2)
  }

  const advanceFromConfig = () => {
    const stake = Number(stakeAmount)
    if (!Number.isFinite(stake) || stake < .1) { notify('error', 'Invalid stake', 'Enter at least 0.1 SOL'); return }
    setCreateStep(3)
  }

  const handleCreate = async () => {
    if (!wallet.connected) { notify('error', 'Wallet required', 'Connect your wallet before creating a battle'); return }
    const stake = Number(stakeAmount)
    const token = selectedToken ?? await loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)
    if (!token || !Number.isFinite(stake) || stake < .1) { notify('error', 'Invalid battle', 'Verify the token and enter at least 0.1 SOL'); return }
    setIsSubmitting(true)
    try {
      const depositSignature = escrowConfigured ? await depositStake(Math.round(stake * 1_000_000_000)) : null
      const newBattle = await createBattle({ getAccessToken, walletAddress: wallet.address, token: { mint: token.mint }, stakeSol: stake, durationSeconds: selectedDuration, depositSignature })
      setBattles((current) => [newBattle, ...current])
      notify('success', 'Battle created', `${token.symbol} is ready for a challenger`)
      closeCreate(); setSelectedToken(null); setTokenAddress(''); setStakeAmount('5')
    } catch (error) { notify('error', 'Battle not created', error.message) } finally { setIsSubmitting(false) }
  }

  const openBattle = (battle) => { setViewBattle(battle); setJoinToken(null); setJoinTokenAddress('') }

  const handleJoin = async () => {
    if (!wallet.connected) { notify('error', 'Wallet required', 'Connect your wallet before joining'); return }
    const token = joinToken ?? await loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)
    if (!token) { notify('error', 'Token required', 'Enter a valid Pump.fun contract address'); return }
    setIsSubmitting(true)
    try {
      const depositSignature = escrowConfigured ? await depositStake(Math.round(Number(viewBattle.stake) * 1_000_000_000)) : null
      const joinedBattle = await joinBattle({ getAccessToken, walletAddress: wallet.address, battleId: viewBattle.id, token: { mint: token.mint }, depositSignature })
      setBattles((current) => current.map((battle) => battle.id === joinedBattle.id ? joinedBattle : battle))
      notify('success', 'Battle joined', 'Your deposit is confirmed')
      setViewBattle(null)
    } catch (error) { notify('error', 'Could not join', error.message) } finally { setIsSubmitting(false) }
  }

  const stake = Number(stakeAmount || 0)
  const duration = DURATIONS.find((item) => item.value === selectedDuration)

  return (
    <section className="page-shell arena-page" ref={pageRef}>
      <div className="arena-header">
        <div className="page-header"><p className="page-kicker">FLIPPEN arena</p><h1 className="page-title">Choose a side.<br />Fight for the crown.</h1><p className="page-subtitle">Browse open matchups, track live performance, or put your own token conviction on the line.</p></div>
        <button className="primary-button arena-create" onClick={() => setCreateOpen(true)}>Create Battle <Icon name="arrowRight" size={18} /></button>
      </div>

      <div className="arena-toolbar" aria-label="Battle filters">
        <div className="filter-group">{Object.keys(filterLabels).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === 'active' && <span className="filter-live-dot" />}{filterLabels[value]}</button>)}</div>
        <label className="battle-search"><span className="sr-only">Search battles by token</span><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search token" /></label>
        <span className="battle-count mono">{filteredBattles.length} MATCHUPS</span>
      </div>

      {isLoading ? <div className="battle-skeleton-grid" aria-label="Loading battles">{[0,1,2,3].map((item) => <div key={item} className="battle-skeleton" />)}</div> : filteredBattles.length ? (
        <div className="battles-grid">{filteredBattles.map((battle) => <div className="battle-grid-item" key={battle.id}><BattleCard battle={battle} onClick={openBattle} /></div>)}</div>
      ) : <div className="empty-state"><CrownMark size={52} /><h2 className="empty-title">No matchups found</h2><p className="empty-text">Clear the filters or open a new battle and wait for a challenger.</p><button className="secondary-button" onClick={() => setCreateOpen(true)}>Create the first matchup</button></div>}

      <Modal isOpen={createOpen} onClose={closeCreate} title="Create Battle" size="wide">
        <ol className="create-progress" aria-label="Battle creation progress">{['Pick token', 'Configure', 'Review'].map((label, index) => <li key={label} className={createStep >= index + 1 ? 'active' : ''}><span>{index + 1}</span>{label}</li>)}</ol>

        {createStep === 1 && <div className="create-step">
          <div className="step-intro"><span className="step-number">01</span><div><h3>Pick your token</h3><p>This is the bag you believe will outperform the challenger.</p></div></div>
          <label className="form-group"><span className="form-label">Pump.fun contract address</span><input className="form-input mono" value={tokenAddress} onChange={(event) => { setTokenAddress(event.target.value); setSelectedToken(null) }} onBlur={() => loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)} placeholder="Paste token CA" autoComplete="off" /></label>
          <div className={`token-verification ${selectedToken ? 'verified' : ''}`} aria-live="polite">{isLookingUpToken ? 'Checking token on Pump.fun…' : selectedToken ? <><Icon name="check" size={19} /><span><strong>{selectedToken.name} (${selectedToken.symbol})</strong>Market cap {formatMarketCap(selectedToken.marketCap)}</span></> : 'Paste a contract address to verify the token.'}</div>
          <button className="form-submit" onClick={advanceFromToken} disabled={isLookingUpToken}>Continue to setup <Icon name="arrowRight" size={18} /></button>
        </div>}

        {createStep === 2 && <div className="create-step">
          <div className="step-intro"><span className="step-number">02</span><div><h3>Configure the matchup</h3><p>Set the stake and how long the performance window stays open.</p></div></div>
          <fieldset className="form-group"><legend className="form-label">Battle duration</legend><div className="duration-grid">{DURATIONS.map((item) => <button type="button" key={item.value} className={selectedDuration === item.value ? 'selected' : ''} onClick={() => setSelectedDuration(item.value)} aria-pressed={selectedDuration === item.value}><strong>{item.time}</strong><span>{item.unit}</span></button>)}</div></fieldset>
          <label className="form-group"><span className="form-label">Your stake</span><div className="stake-input"><input className="form-input mono" type="number" min="0.1" step="0.1" value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} /><span>SOL</span></div><small>Minimum 0.1 SOL. Your challenger must match it.</small></label>
          <div className="settlement-note"><Icon name="protocol" size={20} /><span><strong>Settlement metric</strong>Percentage change in market cap during the battle window.</span></div>
          <div className="step-actions"><button className="secondary-button" onClick={() => setCreateStep(1)}>Back</button><button className="primary-button" onClick={advanceFromConfig}>Review battle <Icon name="arrowRight" size={18} /></button></div>
        </div>}

        {createStep === 3 && <div className="create-step">
          <div className="step-intro"><span className="step-number">03</span><div><h3>Review your challenge</h3><p>Confirm every detail before requesting the wallet transaction.</p></div></div>
          <div className="review-matchup"><div><span>Your token</span><strong>{selectedToken?.symbol}</strong></div><b>VS</b><div><span>Challenger</span><strong>OPEN</strong></div></div>
          <dl className="review-list"><div><dt>Your stake</dt><dd>{stake.toFixed(4)} SOL</dd></div><div><dt>Total pot</dt><dd>{(stake * 2).toFixed(4)} SOL</dd></div><div><dt>Duration</dt><dd>{duration?.time} {duration?.unit}</dd></div><div><dt>Platform fee</dt><dd>{(stake * 2 * PLATFORM_FEE_RATE).toFixed(6)} SOL</dd></div><div><dt>Winner receives</dt><dd className="perf-up">{(stake * 2 * (1 - PLATFORM_FEE_RATE)).toFixed(4)} SOL</dd></div><div><dt>Network</dt><dd>Solana</dd></div></dl>
          <div className="transaction-status"><Icon name={wallet.connected ? 'wallet' : 'warning'} size={19} /><span><strong>{wallet.connected ? 'Ready for wallet review' : 'Connect wallet to continue'}</strong>{isSubmitting ? 'Waiting for signature and confirmation…' : 'The transaction will not submit until you approve it.'}</span></div>
          <div className="step-actions"><button className="secondary-button" onClick={() => setCreateStep(2)} disabled={isSubmitting}>Back</button><button className="form-submit" onClick={handleCreate} disabled={isSubmitting}>{isSubmitting ? 'Confirming battle…' : wallet.connected ? 'Confirm & create battle' : 'Connect wallet to create'} <Icon name="arrowRight" size={18} /></button></div>
        </div>}
      </Modal>

      <Modal isOpen={!!viewBattle} onClose={() => setViewBattle(null)} title={viewBattle ? `${viewBattle.tokenA.symbol} vs ${viewBattle.tokenB?.symbol || 'Open slot'}` : ''} size="wide">
        {viewBattle && <>
          <div className="battle-vs-display"><div className="bvd-side"><span>Creator</span><strong>{viewBattle.tokenA.symbol}</strong>{viewBattle.tokenA.perf !== undefined && <b className={`mono ${viewBattle.tokenA.perf >= 0 ? 'perf-up' : 'perf-down'}`}>{viewBattle.tokenA.perf >= 0 ? '+' : ''}{viewBattle.tokenA.perf}%</b>}<small>{viewBattle.creator}</small></div><div className="bvd-center"><CrownMark size={36} /><strong>VS</strong>{viewBattle.status === 'active' && <span className="mono">{formatTime(Math.max(0, viewBattle.endTime - currentTime))}</span>}</div><div className="bvd-side"><span>Challenger</span><strong>{viewBattle.tokenB?.symbol ?? 'OPEN'}</strong>{viewBattle.tokenB?.perf !== undefined && <b className={`mono ${viewBattle.tokenB.perf >= 0 ? 'perf-up' : 'perf-down'}`}>{viewBattle.tokenB.perf >= 0 ? '+' : ''}{viewBattle.tokenB.perf}%</b>}<small>{viewBattle.opponent ?? 'Awaiting player'}</small></div></div>
          <dl className="battle-info-row"><div><dt>Your stake</dt><dd>{viewBattle.stake} SOL</dd></div><div><dt>Total pot</dt><dd>{viewBattle.pot} SOL</dd></div><div><dt>Duration</dt><dd>{viewBattle.durationLabel}</dd></div><div><dt>Fee</dt><dd>0.25%</dd></div><div><dt>Settlement</dt><dd>% performance</dd></div></dl>
          {viewBattle.status === 'waiting' && <div className="join-confirm"><div className="join-heading"><h3>Join this battle?</h3><p>Choose the token that will challenge {viewBattle.tokenA.symbol}, then confirm the matched deposit.</p></div><label className="form-group"><span className="form-label">Your Pump.fun token</span><input className="form-input mono" value={joinTokenAddress} onChange={(event) => { setJoinTokenAddress(event.target.value); setJoinToken(null) }} onBlur={() => loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)} placeholder="Paste token CA" /></label><div className={`token-verification ${joinToken ? 'verified' : ''}`} aria-live="polite">{isLookingUpJoinToken ? 'Checking token…' : joinToken ? <><Icon name="check" size={19} /><span><strong>{joinToken.name} (${joinToken.symbol})</strong>Market cap {formatMarketCap(joinToken.marketCap)}</span></> : 'Verify a token before depositing.'}</div><div className="transaction-status"><Icon name="wallet" size={19} /><span><strong>{viewBattle.stake} SOL matched deposit</strong>{isSubmitting ? 'Waiting for signature and network confirmation…' : 'Review the wallet request before confirming.'}</span></div><div className="step-actions"><button className="secondary-button" onClick={() => setViewBattle(null)} disabled={isSubmitting}>Cancel</button><button className="form-submit" onClick={handleJoin} disabled={isSubmitting || !joinToken}>{isSubmitting ? 'Confirming deposit…' : 'Confirm & deposit'} <Icon name="arrowRight" size={18} /></button></div></div>}
          {(viewBattle.status === 'finished' || viewBattle.status === 'settled') && <div className="result-section"><CrownMark size={72} /><span>Battle winner</span><strong>{viewBattle.winner ?? 'Pending settlement'}</strong></div>}
        </>}
      </Modal>
    </section>
  )
}
