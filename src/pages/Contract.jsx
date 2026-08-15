import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '../context/useWallet'
import { notify } from '../components/notificationService'
import { Icon } from '../components/BrandMark'
import {
  displayTokenAmount,
  formatFeePercent,
  getOnchainStatus,
  holderMintDecimals,
  isOnchainEscrowEnabled,
  rawTokenAmount,
} from '../services/onchainEscrow'
import './Contract.css'

const EMPTY_PUBLIC_KEY = '11111111111111111111111111111111'
const DEFAULT_MINIMUMS = ['1000', '10000', '100000', '1000000']
const DEFAULT_FEES = ['100', '75', '50', '25', '10']
const PLATFORM_FEE_WALLET = 'HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN'
const SOURCE_BASE = 'https://github.com/fliagoldvargas-hash/Battle/blob/main'

const CODE_PROOFS = [
  {
    eyebrow: 'DEPOSIT PROOF',
    title: 'Exact transfer or no battle',
    file: 'server/escrow.js',
    source: `${SOURCE_BASE}/server/escrow.js`,
    lines: [
      "instruction.parsed.info?.destination === config.treasury",
      'instruction.parsed.info?.source === walletAddress',
      'Number(instruction.parsed.info?.lamports) === Number(expectedLamports)',
    ],
  },
  {
    eyebrow: 'PAYOUT MATH',
    title: 'The locked fee defines the split',
    file: 'server/settlement.js',
    source: `${SOURCE_BASE}/server/settlement.js`,
    lines: [
      'const fee = Math.floor((pot * feeBps) / 10_000)',
      'const prize = pot - fee',
      'return { pot, fee, prize, winner: winnerWallet(battle) }',
    ],
  },
  {
    eyebrow: 'ONE SETTLEMENT',
    title: 'Winner and fee share one transaction',
    file: 'server/settlement.js',
    source: `${SOURCE_BASE}/server/settlement.js`,
    lines: [
      'payouts: [',
      '  { wallet: payout.winner, amount: payout.prize },',
      '  { wallet: settlement.feeTreasury, amount: payout.fee },',
      ']',
    ],
  },
  {
    eyebrow: 'REPLAY GUARD',
    title: 'The same settlement is not sent twice',
    file: 'server/settlement.js',
    source: `${SOURCE_BASE}/server/settlement.js`,
    lines: [
      'reference_id: referenceId,',
      'idempotency_key: referenceId,',
      ".is('settlement_signature', null)",
    ],
  },
]

const solscanAddress = (value, isDevnet) => (
  value ? `https://solscan.io/account/${encodeURIComponent(value)}${isDevnet ? '?cluster=devnet' : ''}` : null
)

export default function Contract() {
  const { wallet, getAccessToken } = useWallet()
  const isDevnet = import.meta.env.VITE_BATTLE_NETWORK === 'devnet'
  const isMainnet = import.meta.env.VITE_BATTLE_NETWORK === 'mainnet'
  const onchainEnabled = isOnchainEscrowEnabled()
  const treasuryMode = import.meta.env.VITE_BATTLE_SETTLEMENT_MODE === 'treasury'
  const configurationEnabled = onchainEnabled || treasuryMode
  const [holderConfig, setHolderConfig] = useState(null)
  const [escrowStatus, setEscrowStatus] = useState(null)
  const [protocolAdmin, setProtocolAdmin] = useState('')
  const [loading, setLoading] = useState(configurationEnabled)
  const [saving, setSaving] = useState(false)
  const [provisioningTreasury, setProvisioningTreasury] = useState(false)
  const [treasuryDetails, setTreasuryDetails] = useState(null)
  const [mint, setMint] = useState('')
  const [minimums, setMinimums] = useState(DEFAULT_MINIMUMS)
  const [fees, setFees] = useState(DEFAULT_FEES)

  const refreshConfig = useCallback(async () => {
    if (!configurationEnabled) return
    setLoading(true)
    try {
      if (treasuryMode) {
        const [response, treasuryResponse] = await Promise.all([
          fetch('/api/holder-fees'),
          fetch('/api/escrow/bootstrap'),
        ])
        const result = await response.json().catch(() => ({}))
        const treasury = await treasuryResponse.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Unable to read the treasury configuration.')
        const nextConfig = {
          initialized: true,
          holderMint: result.holderMint || EMPTY_PUBLIC_KEY,
          decimals: result.holderMintDecimals || 0,
          tierMinimums: result.tierMinimums || DEFAULT_MINIMUMS,
          feeBps: result.feeBps || DEFAULT_FEES.map(Number),
        }
        setEscrowStatus({ configured: Boolean(treasury.configured), mode: 'treasury' })
        setTreasuryDetails((current) => ({ ...current, ...treasury }))
        setHolderConfig(nextConfig)
        setProtocolAdmin(result.adminWallet || '')
        if (result.holderMint) {
          setMint(result.holderMint)
          setMinimums(nextConfig.tierMinimums.map((minimum) => displayTokenAmount(minimum, nextConfig.decimals)))
          setFees(nextConfig.feeBps.map(String))
        }
        return
      }
      const [statusResponse, adminResponse] = await Promise.all([
        getOnchainStatus(),
        fetch('/api/holder-fees').then((response) => response.ok ? response.json() : { adminWallet: null }),
      ])
      setEscrowStatus(statusResponse)
      const nextConfig = statusResponse.holderConfig
      setHolderConfig(nextConfig)
      setProtocolAdmin(adminResponse.adminWallet || '')
      if (nextConfig?.initialized && nextConfig.holderMint !== EMPTY_PUBLIC_KEY) {
        setMint(nextConfig.holderMint)
        setMinimums(nextConfig.tierMinimums.map((minimum) => displayTokenAmount(minimum, nextConfig.decimals)))
        setFees(nextConfig.feeBps.map(String))
      }
    } catch (error) {
      console.warn('Unable to read holder fee configuration', error)
      setEscrowStatus({ configured: false, error: error instanceof Error ? error.message : 'The on-chain escrow status could not be loaded.' })
      setHolderConfig(null)
    } finally {
      setLoading(false)
    }
  }, [configurationEnabled, treasuryMode])

  useEffect(() => { void refreshConfig() }, [refreshConfig])

  const isAdmin = Boolean(wallet.connected && protocolAdmin && wallet.address === protocolAdmin)
  const schedule = useMemo(() => {
    const config = holderConfig
    if (!config?.initialized || config.holderMint === EMPTY_PUBLIC_KEY) {
      return [
        { label: 'No holder token', feeBps: 100 },
        { label: 'Holder tiers', feeBps: null },
      ]
    }
    return [
      { label: `Below ${displayTokenAmount(config.tierMinimums[0], config.decimals)} tokens`, feeBps: config.feeBps[0] },
      ...config.tierMinimums.map((minimum, index) => ({
        label: `${displayTokenAmount(minimum, config.decimals)}+ tokens`, feeBps: config.feeBps[index + 1],
      })),
    ]
  }, [holderConfig])

  const updateArrayValue = (setValue, index, value) => {
    setValue((values) => values.map((current, currentIndex) => currentIndex === index ? value : current))
  }

  const saveWithProtocolAuthority = async (payload) => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Reconnect your wallet before changing the holder schedule.')
    const response = await fetch('/api/holder-fees', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet.address, ...payload }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Holder fee configuration was rejected.')
    return result
  }

  const initialize = async () => {
    setSaving(true)
    try {
      await saveWithProtocolAuthority({ action: 'initialize' })
      notify('success', 'Holder Fees Initialized', 'The default 1% to 0.10% holder schedule is now on-chain. Configure the token CA next.')
      await refreshConfig()
    } catch (error) {
      notify('error', 'Initialization Failed', error instanceof Error ? error.message : 'The holder fee account could not be created.')
    } finally {
      setSaving(false)
    }
  }

  const provisionTreasury = async () => {
    setProvisioningTreasury(true)
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Reconnect the protocol owner wallet before provisioning the treasury.')
      const response = await fetch('/api/escrow/bootstrap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet.address }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Treasury provisioning was rejected.')
      setTreasuryDetails(result)
      notify('success', result.configured ? 'Treasury Found' : 'Treasury Created', 'The dedicated Privy Mainnet wallet is ready for server configuration.')
    } catch (error) {
      notify('error', 'Treasury Not Provisioned', error instanceof Error ? error.message : 'Unable to provision the Privy treasury.')
    } finally {
      setProvisioningTreasury(false)
    }
  }

  const saveSchedule = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const decimals = await holderMintDecimals(mint)
      const tierMinimums = minimums.map((value) => rawTokenAmount(value, decimals))
      const feeBps = fees.map((value) => {
        if (!/^\d+$/.test(value) || Number(value) > 10_000) throw new Error('Fee rates must be whole basis points between 0 and 10,000.')
        return Number(value)
      })
      await saveWithProtocolAuthority({
        ...(treasuryMode ? {} : { action: 'set' }),
        holderMint: mint,
        tierMinimums: tierMinimums.map(String),
        feeBps,
      })
      notify('success', 'Holder Fee Schedule Saved', 'New battles verify this mint balance and lock the matching rate when created.')
      await refreshConfig()
    } catch (error) {
      notify('error', 'Configuration Not Saved', error instanceof Error ? error.message : 'The holder fee schedule could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const treasuryAddress = treasuryDetails?.address || null
  const networkLabel = isMainnet ? 'Solana Mainnet' : 'Solana Devnet'
  const custodyLabel = treasuryMode ? 'Privy managed treasury' : 'On-chain escrow program'

  return (
    <section className="contract-section">
      <div className="page-header">
        <p className="transparency-kicker">Open books. Verifiable transfers.</p>
        <h1 className="page-title">Transparency</h1>
        <p className="page-subtitle">See where funds go, how payouts are calculated, and which guarantees the current code actually provides.</p>
      </div>

      <div className="contract-container">
        <div className="contract-card transparency-hero animate-in">
          <div className="transparency-hero-copy">
            <div className={`protocol-chip ${escrowStatus?.configured ? 'online' : 'pending'}`}><span /> {loading ? 'CHECKING LIVE CONFIGURATION' : escrowStatus?.configured ? 'SETTLEMENT SYSTEM ONLINE' : 'CONFIGURATION INCOMPLETE'}</div>
            <h2>Follow every SOL.</h2>
            <p>Player deposits and settlements are public Solana transactions. FLIPPEN verifies the exact sender, treasury destination and lamport amount before a battle is accepted.</p>
            <div className="transparency-actions">
              <a className="transparency-link primary" href="https://github.com/fliagoldvargas-hash/Battle" target="_blank" rel="noreferrer">
                VIEW SOURCE <Icon name="external" size={16} />
              </a>
              {treasuryAddress && (
                <a className="transparency-link" href={solscanAddress(treasuryAddress, isDevnet)} target="_blank" rel="noreferrer">
                  OPEN TREASURY <Icon name="external" size={16} />
                </a>
              )}
            </div>
          </div>
          <div className="protocol-stamp" aria-label={`${networkLabel} settlement status`}>
            <Icon name="protocol" size={36} />
            <strong>{escrowStatus?.configured ? 'VERIFIED' : 'PENDING'}</strong>
            <span>{networkLabel}</span>
          </div>
        </div>

        <div className="protocol-facts animate-in stagger-2" aria-label="Protocol facts">
          <div className="protocol-fact"><span>NETWORK</span><strong>{networkLabel}</strong></div>
          <div className="protocol-fact"><span>CUSTODY</span><strong>{custodyLabel}</strong></div>
          <div className="protocol-fact"><span>AUTO-PAYOUT CAP</span><strong>20 SOL / BATTLE</strong></div>
          <div className="protocol-fact warning"><span>INDEPENDENT AUDIT</span><strong>NOT COMPLETED</strong></div>
        </div>

        <div className="contract-card animate-in stagger-2">
          <div className="contract-heading-row">
            <div>
              <p className="contract-eyebrow">PUBLIC LEDGER</p>
              <div className="contract-title">Wallets you can verify</div>
            </div>
            <Icon name="external" size={22} />
          </div>
          <p className="contract-copy">These are public addresses, not secrets. Open either one in Solscan to inspect balances and confirmed transfers directly.</p>
          <div className="address-ledger">
            <div className="address-row">
              <div><span>SETTLEMENT TREASURY</span><strong>{treasuryAddress || (loading ? 'Loading public address…' : 'Not configured')}</strong></div>
              {treasuryAddress && <a href={solscanAddress(treasuryAddress, isDevnet)} target="_blank" rel="noreferrer" aria-label="View settlement treasury on Solscan"><Icon name="external" size={18} /></a>}
            </div>
            <div className="address-row">
              <div><span>PLATFORM FEE WALLET</span><strong>{PLATFORM_FEE_WALLET}</strong></div>
              <a href={solscanAddress(PLATFORM_FEE_WALLET, isDevnet)} target="_blank" rel="noreferrer" aria-label="View platform fee wallet on Solscan"><Icon name="external" size={18} /></a>
            </div>
          </div>
        </div>

        <div className="contract-card animate-in stagger-2">
          <p className="contract-eyebrow">SETTLEMENT PATH</p>
          <div className="contract-title">What happens to the pot</div>
          <div className="settlement-flow">
            <div className="flow-step"><b>01</b><div><strong>Deposit</strong><span>Each wallet signs an exact SOL transfer.</span></div></div>
            <div className="flow-step"><b>02</b><div><strong>Verify</strong><span>Finalized source, destination and amount are checked on-chain.</span></div></div>
            <div className="flow-step"><b>03</b><div><strong>Decide</strong><span>The oracle compares Pump.fun performance to four decimals.</span></div></div>
            <div className="flow-step"><b>04</b><div><strong>Settle</strong><span>Prize and locked fee are sent together, then linked on Solscan.</span></div></div>
          </div>
        </div>

        <section className="code-proof-section animate-in stagger-3" aria-labelledby="code-proof-title">
          <div className="code-proof-heading">
            <div><p className="contract-eyebrow">READ THE RULES</p><h2 id="code-proof-title">Proof in the code.</h2></div>
            <p>The snippets below are from the public backend that validates deposits and prepares settlements. Open each source file to inspect the complete implementation.</p>
          </div>
          <div className="code-proof-grid">
            {CODE_PROOFS.map((proof) => (
              <article className="code-proof" key={proof.title}>
                <div className="code-proof-top"><span>{proof.eyebrow}</span><a href={proof.source} target="_blank" rel="noreferrer" aria-label={`Open ${proof.file} on GitHub`}><Icon name="external" size={16} /></a></div>
                <h3>{proof.title}</h3>
                <pre><code>{proof.lines.map((line, index) => <span key={`${proof.title}-${index}`}><i>{String(index + 1).padStart(2, '0')}</i>{line}</span>)}</code></pre>
                <a className="code-file-link" href={proof.source} target="_blank" rel="noreferrer">{proof.file}</a>
              </article>
            ))}
          </div>
        </section>

        <div className="contract-card animate-in stagger-3">
          <p className="contract-eyebrow">LOCKED AT CREATION</p>
          <div className="contract-title">Holder fee schedule</div>
          <p className="contract-copy">The creator’s verified SPL-token balance selects the rate when the battle is created. That fee is stored with the battle; later balance or schedule changes cannot rewrite it.</p>
          <div className="holder-schedule" aria-busy={loading}>
            {schedule.map((tier) => <div className="holder-tier" key={tier.label}><span>{tier.label}</span><strong>{tier.feeBps == null ? 'Not configured' : formatFeePercent(tier.feeBps)}</strong></div>)}
          </div>
          {holderConfig?.initialized && holderConfig.holderMint !== EMPTY_PUBLIC_KEY
            ? <p className="contract-copy contract-copy-mono">Token CA: {holderConfig.holderMint}</p>
            : <div className="status-line status-line-warning"><span aria-hidden="true">!</span>Holder discounts are not active yet. New battles use the standard 1% fee.</div>}
        </div>

        {configurationEnabled && isAdmin && (
          <div className="contract-card admin-contract-card animate-in stagger-3">
            <p className="contract-eyebrow">OWNER CONTROLS</p>
            <div className="contract-title">Admin: treasury and holder token</div>
            {treasuryMode && <><p className="contract-copy">The dedicated Privy treasury belongs to this Privy account. Vercel receives a policy-limited signer rather than an exportable Solana private key.</p><button className="holder-admin-button" type="button" onClick={provisionTreasury} disabled={provisioningTreasury}>{provisioningTreasury ? 'PROVISIONING...' : 'PROVISION SECURE TREASURY'}</button>{treasuryDetails?.address && <p className="contract-copy contract-copy-mono">Treasury: {treasuryDetails.address}{treasuryDetails.walletId && <><br />Wallet ID: {treasuryDetails.walletId}</>}</p>}</>}
            {!holderConfig?.initialized && !treasuryMode ? <><p className="contract-copy">Create the dedicated on-chain configuration account once. This does not set a token CA or change existing battles.</p><button className="holder-admin-button" type="button" onClick={initialize} disabled={saving}>{saving ? 'CONFIRMING...' : 'INITIALIZE HOLDER FEES'}</button></> : (
              <form className="holder-form" onSubmit={saveSchedule}>
                <label>Protocol token CA<input required value={mint} onChange={(event) => setMint(event.target.value.trim())} placeholder="Paste the SPL token mint address" /></label>
                <div className="holder-form-grid holder-form-head"><span>Minimum balance</span><span>Fee (basis points)</span></div>
                {minimums.map((minimum, index) => <div className="holder-form-grid" key={`tier-${index}`}><input required inputMode="decimal" value={minimum} onChange={(event) => updateArrayValue(setMinimums, index, event.target.value)} aria-label={`Tier ${index + 1} token minimum`} /><input required inputMode="numeric" value={fees[index + 1]} onChange={(event) => updateArrayValue(setFees, index + 1, event.target.value)} aria-label={`Tier ${index + 1} fee basis points`} /></div>)}
                <label>Fee without the token (basis points)<input required inputMode="numeric" value={fees[0]} onChange={(event) => updateArrayValue(setFees, 0, event.target.value)} /></label>
                <p className="form-hint">100 basis points = 1%. Default schedule: 1%, 0.75%, 0.50%, 0.25%, 0.10%.</p>
                <button className="holder-admin-button" disabled={saving}>{saving ? 'SAVING...' : 'SAVE HOLDER SCHEDULE'}</button>
              </form>
            )}
          </div>
        )}

        {configurationEnabled && wallet.connected && !isAdmin && (
          <div className="contract-card animate-in stagger-3"><div className="contract-title">Protocol administration</div><p className="contract-copy">{protocolAdmin ? <>The connected wallet <span className="contract-copy-mono">{wallet.address}</span> is not the configured protocol owner. Connect <span className="contract-copy-mono">{protocolAdmin}</span> to change protocol settings.</> : 'Protocol-owner access has not been configured in this environment yet.'}</p></div>
        )}

        <div className="contract-card custody-disclosure animate-in stagger-3">
          <div className="disclosure-icon"><Icon name="warning" size={26} /></div>
          <div>
            <p className="contract-eyebrow">CUSTODY DISCLOSURE</p>
            <div className="contract-title">Transparent does not mean trustless.</div>
            <p className="contract-copy">Mainnet currently uses a custodial Privy treasury controlled by the protocol owner, with a policy-limited backend signer for automatic settlements. The public code contains amount, destination, state and replay checks, but an owner-controlled service is not the same as immutable escrow.</p>
            <p className="contract-copy"><strong>No independent security audit has been completed.</strong> Every user should verify transaction addresses and amounts in their wallet and on Solscan before using real SOL.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
