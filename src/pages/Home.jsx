import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { fetchPlatformStats } from '../services/analytics'
import { fetchPublicBattles } from '../services/battles'
import { CrownMark, Icon } from '../components/BrandMark'
import { PROJECT_TOKEN_CA } from '../config/projectToken'
import './Home.css'

gsap.registerPlugin(useGSAP)

const steps = [
  { number: '01', title: 'Pick your bag', copy: 'Choose a Pump.fun token and set the stake you are willing to defend.' },
  { number: '02', title: 'Find a rival', copy: 'A challenger matches the stake with a different token.' },
  { number: '03', title: 'Let the chart decide', copy: 'Percentage performance settles the matchup when the timer ends.' },
]

export default function Home() {
  const navigate = useNavigate()
  const heroRef = useRef(null)
  const [stats, setStats] = useState(null)
  const [activeBattles, setActiveBattles] = useState([])
  const [caCopied, setCaCopied] = useState(false)

  const copyProjectTokenCa = async () => {
    if (PROJECT_TOKEN_CA === 'SOON') return

    try {
      await navigator.clipboard.writeText(PROJECT_TOKEN_CA)
      setCaCopied(true)
      window.setTimeout(() => setCaCopied(false), 1800)
    } catch {
      setCaCopied(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchPlatformStats(), fetchPublicBattles()]).then(([statsResult, battlesResult]) => {
      if (cancelled) return
      if (statsResult.status === 'fulfilled') setStats(statsResult.value)
      if (battlesResult.status === 'fulfilled') setActiveBattles((battlesResult.value ?? []).slice(0, 2))
    })
    return () => { cancelled = true }
  }, [])

  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const timeline = gsap.timeline({ defaults: { duration: .48, ease: 'power3.out' } })
      timeline
        .from('.hero-crown', { autoAlpha: 0, y: 18, scale: .86 })
        .from('.hero-copy > *', { autoAlpha: 0, y: 20, stagger: .06 }, '-=.24')
        .from('.matchup-side, .matchup-vs', { autoAlpha: 0, y: 16, stagger: .07 }, '-=.25')
    })
    return () => mm.revert()
  }, { scope: heroRef })

  return (
    <div className="home-page" ref={heroRef}>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-crown" aria-hidden="true"><CrownMark size={150} title="" /></div>
        <div className="hero-copy">
          <p className="hero-kicker"><span /> Trading battles on Solana</p>
          <h1 id="home-title">Pick a bag.<br /><span>Enter the arena.</span><br />Let the chart decide.</h1>
          <p className="hero-subtitle">Stake SOL behind a Pump.fun token, face another trader, and let percentage performance settle the pot.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigate('/battles?create=1')}>Create Battle <Icon name="arrowRight" size={19} /></button>
            <button className="secondary-button" onClick={() => navigate('/battles')}>Browse Battles</button>
          </div>
        </div>

        <div className="hero-arena">
          <div className="hero-matchup" aria-label="ANSEM versus TOAD token matchup">
            <div className="matchup-side matchup-a">
              <img className="token-image" src="/token-icons/ansem.png" alt="ANSEM token" />
              <div><strong>ANSEM</strong><span>Momentum pick</span></div>
              <b className="perf-up mono">+12.84%</b>
            </div>
            <div className="matchup-vs"><span>VS</span></div>
            <div className="matchup-side matchup-b">
              <img className="token-image token-image-b" src="/token-icons/toad.png" alt="TOAD token" />
              <div><strong>TOAD</strong><span>Challenger</span></div>
              <b className="perf-down mono">-3.27%</b>
            </div>
          </div>
          <div className="project-token-ca" aria-label="FLIPPEN token contract address">
            <span className="project-token-ca-label">FLIPPEN CA</span>
            <code>{PROJECT_TOKEN_CA}</code>
            <button
              type="button"
              className="project-token-ca-copy"
              onClick={copyProjectTokenCa}
              disabled={PROJECT_TOKEN_CA === 'SOON'}
              aria-label={PROJECT_TOKEN_CA === 'SOON' ? 'Token contract address coming soon' : 'Copy FLIPPEN token contract address'}
            >
              <Icon name="copy" size={16} />
              {caCopied ? 'Copied' : 'Copy CA'}
            </button>
          </div>
        </div>

        <div className="hero-stats" aria-label="Platform metrics">
          <div><span>Battles</span><strong>{stats?.battles ?? '—'}</strong></div>
          <div><span>Volume</span><strong>{stats ? `${stats.volume.toFixed(2)} SOL` : '—'}</strong></div>
          <div><span>Warriors</span><strong>{stats?.warriors ?? '—'}</strong></div>
        </div>
      </section>

      <section className="home-chapter" aria-labelledby="how-title">
        <div className="chapter-heading"><p className="page-kicker">Three moves. One winner.</p><h2 id="how-title">How the arena works</h2></div>
        <div className="steps-grid">
          {steps.map((step) => <article key={step.number} className="step-card"><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}
        </div>
      </section>

      <section className="home-chapter live-preview" aria-labelledby="live-title">
        <div className="chapter-heading"><p className="page-kicker">Real arena data</p><h2 id="live-title">Battles in play</h2></div>
        {activeBattles.length ? (
          <div className="preview-grid">
            {activeBattles.map((battle) => (
              <button key={battle.id} className="preview-battle" onClick={() => navigate('/battles')}>
                <span className={`status-dot ${battle.status}`} />
                <strong>{battle.tokenA.symbol}</strong><span>VS</span><strong>{battle.tokenB?.symbol ?? 'OPEN'}</strong>
                <small className="mono">{battle.pot} SOL POT</small>
                <Icon name="arrowRight" size={18} />
              </button>
            ))}
          </div>
        ) : <div className="preview-empty"><CrownMark size={46} /><p>No active battles to preview. The crown is unclaimed.</p></div>}
      </section>

      <section className="home-final-cta">
        <CrownMark size={74} />
        <h2>Your bag. Your call. Your crown.</h2>
        <p>Enter with a token you believe can outperform the other side.</p>
        <button className="primary-button" onClick={() => navigate('/battles?create=1')}>Build your matchup <Icon name="arrowRight" size={19} /></button>
      </section>
    </div>
  )
}
