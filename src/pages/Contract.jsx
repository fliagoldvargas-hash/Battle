import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '../context/useWallet'
import { notify } from '../components/notificationService'
import {
  displayTokenAmount,
  formatFeePercent,
  getHolderFeeConfig,
  holderMintDecimals,
  isOnchainEscrowEnabled,
  rawTokenAmount,
} from '../services/onchainEscrow'
import './Contract.css'

const EMPTY_PUBLIC_KEY = '11111111111111111111111111111111'
const DEFAULT_MINIMUMS = ['1000', '10000', '100000', '1000000']
const DEFAULT_FEES = ['100', '75', '50', '25', '10']

export default function Contract() {
  const { wallet, getAccessToken } = useWallet()
  const isDevnet = import.meta.env.VITE_BATTLE_NETWORK === 'devnet'
  const isMainnet = import.meta.env.VITE_BATTLE_NETWORK === 'mainnet'
  const onchainEnabled = isOnchainEscrowEnabled()
  const [holderConfig, setHolderConfig] = useState(null)
  const [protocolAdmin, setProtocolAdmin] = useState('')
  const [loading, setLoading] = useState(onchainEnabled)
  const [saving, setSaving] = useState(false)
  const [mint, setMint] = useState('')
  const [minimums, setMinimums] = useState(DEFAULT_MINIMUMS)
  const [fees, setFees] = useState(DEFAULT_FEES)

  const refreshConfig = useCallback(async () => {
    if (!onchainEnabled) return
    setLoading(true)
    try {
      const [nextConfig, adminResponse] = await Promise.all([
        getHolderFeeConfig(),
        fetch('/api/holder-fees').then((response) => response.ok ? response.json() : { adminWallet: null }),
      ])
      setHolderConfig(nextConfig)
      setProtocolAdmin(adminResponse.adminWallet || '')
      if (nextConfig.initialized && nextConfig.holderMint !== EMPTY_PUBLIC_KEY) {
        setMint(nextConfig.holderMint)
        setMinimums(nextConfig.tierMinimums.map((minimum) => displayTokenAmount(minimum, nextConfig.decimals)))
        setFees(nextConfig.feeBps.map(String))
      }
    } catch (error) {
      console.warn('Unable to read holder fee configuration', error)
      notify('error', 'Protocol Configuration Unavailable', 'The on-chain holder fee settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [onchainEnabled])

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
        action: 'set',
        holderMint: mint,
        tierMinimums: tierMinimums.map(String),
        feeBps,
      })
      notify('success', 'Holder Fee Schedule Saved', 'New battles will verify this mint balance on-chain and lock in the matching rate.')
      await refreshConfig()
    } catch (error) {
      notify('error', 'Configuration Not Saved', error instanceof Error ? error.message : 'The holder fee schedule could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="contract-section">
      <div className="page-header">
        <h1 className="page-title">Protocol status</h1>
        <p className="page-subtitle">Clear information about what this deployment can do today.</p>
      </div>

      <div className="contract-container">
        <div className="contract-card animate-in">
          <div className="contract-title">On-chain contract</div>
          <div className="status-line status-line-neutral">
            <span aria-hidden="true">i</span>
            {isDevnet ? 'Devnet escrow program deployed for testing.' : isMainnet ? 'Mainnet escrow program deployed for real-fund settlement.' : 'Contract status is not available in this deployment.'}
          </div>
          <p className="contract-copy">
            {isDevnet
              ? 'Both player deposits are held by the Token Battle escrow program on Solana Devnet. Devnet SOL has no monetary value and this preview must not be used for real funds.'
              : isMainnet
                ? 'Both player deposits are held by the Token Battle escrow program on Solana Mainnet. The oracle settles the battle on-chain after it ends, sending the locked fee and remaining pot in the same transaction.'
                : 'This screen does not make claims about an escrow deployment or real-fund settlement.'}
          </p>
        </div>

        <div className="contract-card animate-in stagger-2">
          <div className="contract-title">Holder fee schedule</div>
          <p className="contract-copy">The rate is chosen from the creator’s verified SPL-token balance when the battle is created, then stored in that battle’s escrow account. A later balance or schedule change cannot alter it.</p>
          <div className="holder-schedule" aria-busy={loading}>
            {schedule.map((tier) => (
              <div className="holder-tier" key={tier.label}>
                <span>{tier.label}</span>
                <strong>{tier.feeBps == null ? 'Not configured' : formatFeePercent(tier.feeBps)}</strong>
              </div>
            ))}
          </div>
          {holderConfig?.initialized && holderConfig.holderMint !== EMPTY_PUBLIC_KEY ? (
            <p className="contract-copy contract-copy-mono">Token CA: {holderConfig.holderMint}</p>
          ) : (
            <div className="status-line status-line-warning"><span aria-hidden="true">!</span>Holder discounts are not active yet. New battles use the standard 1% fee.</div>
          )}
        </div>

        {onchainEnabled && isAdmin && (
          <div className="contract-card animate-in stagger-3">
            <div className="contract-title">Admin: configure holder token</div>
            {!holderConfig?.initialized ? (
              <>
                <p className="contract-copy">Create the dedicated on-chain configuration account once. This does not set a token CA and does not change any existing battle.</p>
                <button className="holder-admin-button" type="button" onClick={initialize} disabled={saving}>
                  {saving ? 'CONFIRMING...' : 'INITIALIZE HOLDER FEES'}
                </button>
              </>
            ) : (
              <form className="holder-form" onSubmit={saveSchedule}>
                <label>Protocol token CA
                  <input required value={mint} onChange={(event) => setMint(event.target.value.trim())} placeholder="Paste the SPL token mint address" />
                </label>
                <div className="holder-form-grid holder-form-head"><span>Minimum balance</span><span>Fee (basis points)</span></div>
                {minimums.map((minimum, index) => (
                  <div className="holder-form-grid" key={`tier-${index}`}>
                    <input required inputMode="decimal" value={minimum} onChange={(event) => updateArrayValue(setMinimums, index, event.target.value)} aria-label={`Tier ${index + 1} token minimum`} />
                    <input required inputMode="numeric" value={fees[index + 1]} onChange={(event) => updateArrayValue(setFees, index + 1, event.target.value)} aria-label={`Tier ${index + 1} fee basis points`} />
                  </div>
                ))}
                <label>Fee without the token (basis points)
                  <input required inputMode="numeric" value={fees[0]} onChange={(event) => updateArrayValue(setFees, 0, event.target.value)} />
                </label>
                <p className="form-hint">100 basis points = 1%. Default schedule: 1%, 0.75%, 0.50%, 0.25%, 0.10%.</p>
                <button className="holder-admin-button" disabled={saving}>{saving ? 'SAVING...' : 'SAVE HOLDER SCHEDULE'}</button>
              </form>
            )}
          </div>
        )}

        {onchainEnabled && wallet.connected && !isAdmin && (
          <div className="contract-card animate-in stagger-3">
            <div className="contract-title">Holder token administration</div>
            <p className="contract-copy">
              {protocolAdmin
                ? 'Only the configured protocol owner wallet can load or change the holder-token CA and fee tiers.'
                : 'Protocol-owner access has not been configured in this environment yet.'}
            </p>
          </div>
        )}

        <div className="contract-card animate-in stagger-3">
          <div className="contract-title">Settlement</div>
          <ul className="protocol-list">
            <li>Both players deposit SOL before a battle becomes active.</li>
            <li>The oracle compares both Pump.fun market-cap changes to four decimals at settlement.</li>
            <li>Settlement sends the fee locked in the escrow battle and automatically pays the remaining pot to the winner after the battle ends.</li>
            <li>As a fallback, either player can refund both stakes after the configured safety delay.</li>
          </ul>
        </div>

        <div className="contract-card animate-in stagger-3">
          <div className="contract-title">Security review</div>
          <div className="status-line status-line-neutral"><span aria-hidden="true">i</span>No independent audit has been completed yet.</div>
          <p className="contract-copy">Do not treat this protocol as audited or trustless. The escrow program has not undergone an independent security audit.</p>
        </div>
      </div>
    </section>
  )
}
