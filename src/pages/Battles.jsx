import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import BattleCard from '../components/BattleCard'
import Modal from '../components/Modal'
import { DURATIONS } from '../data/mockData'
import { useWallet } from '../context/useWallet'
import { notify } from '../components/notificationService'
import { fetchPublicBattles } from '../services/battles'
import { cancelBattle, confirmBattleDeposit, createBattle, joinBattle, recoverOnchainBattles, refreshBattleDepositBlockhash, syncOnchainBattle, syncOnchainEscrowAction } from '../services/battleActions'
import { cancelOnchainBattle, createOnchainBattle, formatFeePercent, getHolderFeeQuote, getOnchainStatus, isOnchainEscrowEnabled, joinOnchainBattle, refundExpiredOnchainBattle } from '../services/onchainEscrow'
import { lookupPumpFunToken } from '../services/pumpfunTokens'
import { solanaExplorerAddress, solanaExplorerTransaction, transactionSignatures } from '../services/solanaExplorer'
import './Battles.css'

const REFUND_DELAY_SECONDS = 86_400
const NETWORK = import.meta.env.VITE_BATTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'Mainnet' : 'Devnet'
const TREASURY_MODE = import.meta.env.VITE_BATTLE_SETTLEMENT_MODE === 'treasury'

function actionErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) return error.message
  const message = error?.message ?? error?.error?.message ?? error?.reason
  return message && String(message).trim() ? String(message) : fallback
}

export default function Battles() {
  const { wallet, getAccessToken, depositStake, ensureWalletSession, escrowConfigured, signAndSendSolanaTransaction } = useWallet()
  const [searchParams, setSearchParams] = useSearchParams()
  const [battles, setBattles] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [viewBattle, setViewBattle] = useState(null)
  const [selectedDuration, setSelectedDuration] = useState(3600)
  const [stakeAmount, setStakeAmount] = useState('0.014')
  const [selectedToken, setSelectedToken] = useState(null)
  const [tokenAddress, setTokenAddress] = useState('')
  const [joinToken, setJoinToken] = useState(null)
  const [joinTokenAddress, setJoinTokenAddress] = useState('')
  const [isLookingUpToken, setIsLookingUpToken] = useState(false)
  const [isLookingUpJoinToken, setIsLookingUpJoinToken] = useState(false)
  const availableDurations = DURATIONS
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')
  const [holderFeeQuote, setHolderFeeQuote] = useState(null)
  const [onchainStatus, setOnchainStatus] = useState(null)
  const recoveredWallet = useRef('')
  const escrowConfiguredForDeployment = isOnchainEscrowEnabled()
  const isOnchainEscrow = escrowConfiguredForDeployment && onchainStatus?.configured === true

  useEffect(() => {
    if (searchParams.get('create') !== '1') return

    setCreateOpen(true)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('create')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!escrowConfiguredForDeployment) return undefined
    let cancelled = false
    void getOnchainStatus()
      .then((status) => { if (!cancelled) setOnchainStatus(status) })
      .catch((error) => {
        console.warn('Unable to read on-chain escrow status', error)
        if (!cancelled) setOnchainStatus({ configured: false })
      })
    return () => { cancelled = true }
  }, [escrowConfiguredForDeployment])

  const refreshBattles = useCallback(async () => {
    const remoteBattles = await fetchPublicBattles()
    setBattles(remoteBattles ?? [])
    setViewBattle(current => current
      ? (remoteBattles ?? []).find(battle => battle.id === current.id) ?? current
      : current)
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
    }, 5_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refreshBattles])

  useEffect(() => {
    if (!wallet.connected || !isOnchainEscrowEnabled() || recoveredWallet.current === wallet.address) return
    recoveredWallet.current = wallet.address
    void recoverOnchainBattles({ getAccessToken, walletAddress: wallet.address })
      .then((recovered) => {
        if (recovered.length) {
          notify('info', 'Battle Restored', 'Your confirmed on-chain battle was restored.')
          return refreshBattles()
        }
        return undefined
      })
      .catch((error) => {
        console.warn('On-chain battle recovery skipped', error)
      })
  }, [getAccessToken, refreshBattles, wallet.address, wallet.connected])

  useEffect(() => {
    let cancelled = false
    if (!wallet.connected || (!isOnchainEscrow && !TREASURY_MODE)) {
      setHolderFeeQuote(null)
      return undefined
    }
    const quote = TREASURY_MODE
      ? fetch(`/api/holder-fees?wallet=${encodeURIComponent(wallet.address)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error('Unable to read the holder fee quote.')))
      : getHolderFeeQuote(wallet.address)
    void quote
      .then((quote) => {
        if (!cancelled) setHolderFeeQuote(quote)
      })
      .catch((error) => {
        console.warn('Unable to read holder fee quote', error)
        if (!cancelled) setHolderFeeQuote(null)
      })
    return () => { cancelled = true }
  }, [isOnchainEscrow, wallet.address, wallet.connected])

  const filteredBattles = useMemo(() => {
    let list = [...battles]
    if (filter === 'waiting') list = list.filter(battle => battle.status === 'waiting')
    if (filter === 'active') list = list.filter(battle => battle.status === 'active')
    if (filter === 'finished') {
      list = list.filter(battle => battle.status === 'finished' || battle.status === 'settled')
    }
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

  const recoverConfirmedOnchainBattle = async (battleAddress) => {
    // The wallet can broadcast before every RPC replica has the new
    // account state. Keep synchronizing a confirmed action instead of showing
    // a false error to the user.
    for (const delay of [0, 1_500, 3_000, 4_500]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
      const recovered = await recoverOnchainBattles({ getAccessToken, walletAddress: wallet.address })
      const battle = recovered.find((candidate) => candidate.onchainBattleAddress === battleAddress)
      if (battle) {
        await refreshBattles()
        return battle
      }
    }
    return null
  }

  const completeTreasuryDeposit = async ({ prepared, action, token, walletAddress }) => {
    let currentPrepared = prepared

    // A Solana blockhash is intentionally short-lived. If a user leaves the
    // wallet approval open for too long, the first transaction cannot ever be
    // accepted by the network. Request one fresh approval instead of leaving
    // the battle in an error state or risking a second unverified deposit.
    for (let approvalAttempt = 0; approvalAttempt < 2; approvalAttempt += 1) {
      const depositSignature = escrowConfigured
        ? await depositStake(currentPrepared.stakeLamports, currentPrepared.recentBlockhash)
        : null
      try {
        return await confirmBattleDeposit({
          getAccessToken,
          walletAddress,
          action,
          token,
          depositIntentId: currentPrepared.depositIntentId,
          depositSignature,
          lastValidBlockHeight: currentPrepared.recentBlockhash?.lastValidBlockHeight,
        })
      } catch (error) {
        if (error?.code !== 'DEPOSIT_EXPIRED' || approvalAttempt === 1) throw error
        notify('info', 'Refreshing Wallet Approval', 'The first Solana approval expired before it was sent. No SOL was transferred; please approve the fresh request.')
        currentPrepared = await refreshBattleDepositBlockhash({
          getAccessToken,
          walletAddress,
          depositIntentId: currentPrepared.depositIntentId,
        })
      }
    }

    throw new Error('Unable to refresh the wallet approval.')
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
    if (escrowConfiguredForDeployment && !isOnchainEscrow) {
      notify('error', 'Escrow Not Ready', `The ${NETWORK_LABEL} escrow is not initialized yet. No wallet transaction was requested.`)
      return
    }
    if (TREASURY_MODE && !escrowConfigured) {
      notify('error', 'Treasury Not Ready', 'The secure Mainnet treasury is not configured yet. No wallet transaction was requested.')
      return
    }
    const stake = Number(stakeAmount)
    const token = selectedToken ?? await loadToken(tokenAddress, setSelectedToken, setIsLookingUpToken)
    if (!token || !Number.isFinite(stake) || stake < 0.014) {
      notify('error', 'Invalid Battle', 'Enter a valid Pump.fun CA and a stake of at least 0.014 SOL')
      return
    }

    setCreateError('')
    setIsSubmitting(true)
    try {
      const currentWallet = ensureWalletSession()
      const walletAddress = currentWallet.address
      const newBattle = isOnchainEscrowEnabled()
        ? await (async () => {
          const onchain = await createOnchainBattle({
            wallet: currentWallet, signAndSendTransaction: signAndSendSolanaTransaction,
            tokenMint: token.mint, stakeLamports: Math.round(stake * 1_000_000_000), durationSeconds: selectedDuration,
          })
          try {
            return await syncOnchainBattle({
              getAccessToken, walletAddress,
              body: { action: 'create', ...onchain },
            })
          } catch (syncError) {
            const recovered = await recoverConfirmedOnchainBattle(onchain.battleAddress)
            if (recovered) return recovered
            throw syncError
          }
        })()
        : await (async () => {
          const prepared = await createBattle({
            getAccessToken, walletAddress, token: { mint: token.mint },
            stakeSol: stake, durationSeconds: selectedDuration,
          })
          return completeTreasuryDeposit({ prepared, action: 'create', token: { mint: token.mint }, walletAddress })
        })()
      setBattles(currentBattles => [newBattle, ...currentBattles])
      notify('success', 'Battle Created!', `${token.symbol} battle was saved`)
      setCreateOpen(false)
      setSelectedToken(null)
      setTokenAddress('')
      setStakeAmount('0.014')
    } catch (error) {
      const message = actionErrorMessage(error, 'The wallet could not create this battle. Approve the wallet transaction and try again.')
      console.error('Battle creation failed', error)
      setCreateError(message)
      notify('error', 'Battle Not Created', message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openBattle = (battle) => {
    // Defer the modal's substantial details render until after the button
    // event has completed. Otherwise Chrome reports a misleading INP issue
    // against the Join button even though no wallet action has started.
    window.setTimeout(() => {
      startTransition(() => {
        setViewBattle(battle)
        setJoinToken(null)
        setJoinTokenAddress('')
      })
    }, 0)
  }

  const handleJoin = async () => {
    if (!wallet.connected) {
      notify('error', 'Wallet Required', 'Please connect your wallet before joining a battle')
      return
    }
    if (escrowConfiguredForDeployment && !isOnchainEscrow) {
      notify('error', 'Escrow Not Ready', `The ${NETWORK_LABEL} escrow is not initialized yet. No wallet transaction was requested.`)
      return
    }
    if (TREASURY_MODE && !escrowConfigured) {
      notify('error', 'Treasury Not Ready', 'The secure Mainnet treasury is not configured yet. No wallet transaction was requested.')
      return
    }
    const token = joinToken ?? await loadToken(joinTokenAddress, setJoinToken, setIsLookingUpJoinToken)
    if (!token) {
      notify('error', 'Token Required', 'Enter a valid Pump.fun contract address')
      return
    }

    setIsSubmitting(true)
    try {
      const currentWallet = ensureWalletSession()
      const walletAddress = currentWallet.address
      let joinedBattle
      if (isOnchainEscrowEnabled()) {
        const onchain = await joinOnchainBattle({
          wallet: currentWallet, signAndSendTransaction: signAndSendSolanaTransaction,
          battleIdHex: viewBattle.onchainBattleId, tokenMint: token.mint,
        })
        try {
          joinedBattle = await syncOnchainBattle({
            getAccessToken, walletAddress,
            body: { action: 'join', ...onchain, battleId: viewBattle.onchainBattleId },
          })
        } catch (syncError) {
          joinedBattle = await recoverConfirmedOnchainBattle(onchain.battleAddress)
          if (!joinedBattle) throw syncError
        }
      } else {
        joinedBattle = await (async () => {
          const prepared = await joinBattle({ getAccessToken, walletAddress, battleId: viewBattle.id })
          return completeTreasuryDeposit({ prepared, action: 'join', token: { mint: token.mint }, walletAddress })
        })()
      }
      setBattles(currentBattles => currentBattles.map(battle => battle.id === joinedBattle.id ? joinedBattle : battle))
      notify('success', 'Joined Battle!', `You joined against ${viewBattle.tokenA.symbol}`)
      setViewBattle(null)
    } catch (error) {
      notify('error', 'Could Not Join', error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!viewBattle) return
    setIsSubmitting(true)
    try {
      const currentWallet = ensureWalletSession()
      const walletAddress = currentWallet.address
      if (isOnchainEscrow) {
        const onchain = await cancelOnchainBattle({
          wallet: currentWallet, signAndSendTransaction: signAndSendSolanaTransaction,
          battleIdHex: viewBattle.onchainBattleId,
        })
        await syncOnchainEscrowAction({
          getAccessToken, walletAddress,
          body: { action: 'cancel', ...onchain },
        })
      } else {
        await cancelBattle({
          getAccessToken, walletAddress, battleId: viewBattle.id,
        })
      }
      setBattles(currentBattles => currentBattles.filter((battle) => battle.id !== viewBattle.id))
      setViewBattle(null)
      notify('success', 'Battle Cancelled', `Your ${NETWORK_LABEL} refund was sent back to your wallet.`)
    } catch (error) {
      notify('error', 'Could Not Cancel', error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRefund = async () => {
    if (!viewBattle || !isOnchainEscrow) return
    setIsSubmitting(true)
    try {
      const currentWallet = ensureWalletSession()
      const walletAddress = currentWallet.address
      const onchain = await refundExpiredOnchainBattle({
        wallet: currentWallet, signAndSendTransaction: signAndSendSolanaTransaction,
        battleIdHex: viewBattle.onchainBattleId,
        creatorAddress: viewBattle.creatorAddress,
        opponentAddress: viewBattle.opponentAddress,
      })
      await syncOnchainEscrowAction({
        getAccessToken, walletAddress,
        body: { action: 'refund', ...onchain },
      })
      setBattles(currentBattles => currentBattles.filter((battle) => battle.id !== viewBattle.id))
      setViewBattle(null)
      notify('success', 'Battle Refunded', `Both ${NETWORK_LABEL} stakes have been returned to their wallets.`)
    } catch (error) {
      notify('error', 'Could Not Refund', error.message)
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

  const feeBps = holderFeeQuote?.feeBps ?? 100
  const feeRate = feeBps / 10_000

  return (
    <section className="battles-section">
      <div className="page-header">
        <h1 className="page-title">⚔ Battles</h1>
        <p className="page-subtitle">Browse open battles or create your own challenge</p>
        {escrowConfiguredForDeployment && !isOnchainEscrow && (
          <div className="devnet-notice" role="status">
            <strong>ESCROW NOT READY</strong>
            <span>The {NETWORK_LABEL} program has not been initialized. Creating and joining battles are disabled until the on-chain setup is verified.</span>
          </div>
        )}
        {isOnchainEscrow && (
          <div className="devnet-notice" role="status">
            <strong>{NETWORK === 'devnet' ? 'DEVNET TEST MODE' : 'MAINNET ESCROW'}</strong>
            <span>{NETWORK === 'devnet' ? 'Uses test SOL only. ' : ''}The oracle compares both tokens to four decimals and settles completed battles automatically.</span>
          </div>
        )}
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
          <button className="create-battle-btn" onClick={() => setCreateOpen(true)} disabled={escrowConfiguredForDeployment && !isOnchainEscrow}>
            + Create Battle
          </button>
        </div>

        {filteredBattles.length > 0 ? (
          <div className="battles-grid">
            {filteredBattles.map((battle, i) => (
              <div key={battle.id} className="animate-in" style={{ animationDelay: `${i * 0.08}s` }}>
                <BattleCard battle={battle} onClick={openBattle} walletAddress={wallet.address} />
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
          {createError && <p className="form-hint form-hint-error" role="alert">{createError}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">Battle Duration</label>
          <div className="duration-grid">
            {availableDurations.map(d => (
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
            min="0.014"
            max="10"
            step="0.001"
          />
        </div>

        <div className="stake-display">
          <div className="stake-stat">
            <span className="stake-display-label">Total pot <span>(matched)</span></span>
            <span className="stake-display-value">{(parseFloat(stakeAmount || 0) * 2).toFixed(4)} SOL</span>
          </div>
          <div className="stake-stat">
            <span className="stake-display-label">Platform fee <span>({formatFeePercent(feeBps)})</span></span>
            <span className="stake-display-value">{(parseFloat(stakeAmount || 0) * 2 * feeRate).toFixed(6)} SOL</span>
          </div>
          <div className="stake-stat">
            <span className="stake-display-label">Winner receives</span>
            <span className="stake-display-value">{(parseFloat(stakeAmount || 0) * 2 * (1 - feeRate)).toFixed(4)} SOL</span>
          </div>
        </div>

        {isOnchainEscrow && (
          <p className="form-hint">
            {holderFeeQuote?.initialized && holderFeeQuote.holderMint !== '11111111111111111111111111111111'
              ? `Your verified holder balance sets this battle's ${formatFeePercent(feeBps)} fee. The rate is locked on-chain when you create it.`
              : 'Standard fee: 1%. Holder discounts will activate after the protocol token CA is configured.'}
          </p>
        )}
        {TREASURY_MODE && (
          <p className="form-hint">
            Your stake is sent to the protocol's dedicated Privy treasury. The verified {formatFeePercent(feeBps)} fee is locked when this battle is created; winner payment and the platform fee are sent automatically after settlement.
          </p>
        )}

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
            {(() => {
              const isCreator = wallet.connected && viewBattle.creatorAddress === wallet.address
              const isParticipant = isCreator || (wallet.connected && viewBattle.opponentAddress === wallet.address)
              const canCancel = viewBattle.status === 'waiting' && isCreator && (isOnchainEscrow || TREASURY_MODE)
              const canRefund = isOnchainEscrow && viewBattle.status === 'active' && isParticipant
                && viewBattle.endTime && currentTime >= viewBattle.endTime + REFUND_DELAY_SECONDS
              const refundAt = viewBattle.endTime ? new Date((viewBattle.endTime + REFUND_DELAY_SECONDS) * 1000).toLocaleString() : null
              return (
                <>
            <div className="battle-vs-display">
              <div className="bvd-side a">
                <div className="bvd-symbol">{viewBattle.tokenA.symbol}</div>
                {viewBattle.tokenA.perf !== undefined && (
                  <div className={`bvd-perf ${viewBattle.tokenA.perf >= 0 ? 'perf-up' : 'perf-down'}`}>
                    {viewBattle.tokenA.perf >= 0 ? '+' : ''}{Number(viewBattle.tokenA.perf).toFixed(4)}%
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
                        {viewBattle.tokenB.perf >= 0 ? '+' : ''}{Number(viewBattle.tokenB.perf).toFixed(4)}%
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

            {(viewBattle.onchainBattleAddress || viewBattle.treasuryAddress || viewBattle.creatorDepositSignature || viewBattle.opponentDepositSignature || viewBattle.settlementSignature) && (
              <section className="onchain-activity" aria-label="On-chain activity">
                <div className="onchain-activity-heading">
                  <div>
                    <strong>On-chain activity</strong>
                    <span>Verify every deposit and payment directly on Solana Explorer.</span>
                  </div>
                  <span className="onchain-network">{viewBattle.network === 'devnet' ? 'DEVNET' : 'MAINNET'}</span>
                </div>
                <div className="onchain-activity-list">
                  <a href={solanaExplorerAddress(viewBattle.onchainBattleAddress || viewBattle.treasuryAddress, viewBattle.network)} target="_blank" rel="noreferrer" className="onchain-activity-item">
                    <span className="onchain-activity-label">{viewBattle.onchainBattleAddress ? 'Battle escrow account' : 'Settlement treasury'}</span>
                    <span>View account ↗</span>
                  </a>
                  {solanaExplorerTransaction(viewBattle.creatorDepositSignature, viewBattle.network) && (
                    <a href={solanaExplorerTransaction(viewBattle.creatorDepositSignature, viewBattle.network)} target="_blank" rel="noreferrer" className="onchain-activity-item">
                      <span className="onchain-activity-label">Creator deposit</span>
                      <span>View transaction ↗</span>
                    </a>
                  )}
                  {solanaExplorerTransaction(viewBattle.opponentDepositSignature, viewBattle.network) && (
                    <a href={solanaExplorerTransaction(viewBattle.opponentDepositSignature, viewBattle.network)} target="_blank" rel="noreferrer" className="onchain-activity-item">
                      <span className="onchain-activity-label">Challenger deposit</span>
                      <span>View transaction ↗</span>
                    </a>
                  )}
                  {transactionSignatures(viewBattle.settlementSignature).map((signature, index) => {
                    const settlementUrl = solanaExplorerTransaction(signature, viewBattle.network)
                    if (!settlementUrl) return null
                    return (
                      <a key={signature} href={settlementUrl} target="_blank" rel="noreferrer" className="onchain-activity-item">
                        <span className="onchain-activity-label">{viewBattle.escrowState === 'refunded' ? 'Refund payment' : `Settlement & payouts${index ? ` #${index + 1}` : ''}`}</span>
                        <span>{viewBattle.escrowState === 'refunded' ? 'View refund ↗' : 'Winner payment + fee ↗'}</span>
                      </a>
                    )
                  })}
                </div>
              </section>
            )}

            {isOnchainEscrow && viewBattle.status === 'active' && (
              <div className="escrow-status" role="status">
                <strong>Escrow funded on {NETWORK_LABEL}</strong>
                <span>The {viewBattle.pot} SOL pot is locked. At completion, the oracle records both results, sends the fee locked for this battle, and pays the winner automatically.</span>
                {refundAt && <small>Fallback: either participant can refund both stakes after {refundAt} if settlement is still unavailable.</small>}
              </div>
            )}

            {!isOnchainEscrow && viewBattle.status === 'active' && viewBattle.tokenA.perf !== undefined && viewBattle.tokenB?.perf !== undefined && (
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
                <div className="live-price-stamp" role="status">
                  <span className="live-dot" /> LIVE PUMP.FUN DATA · REFRESHES EVERY 5 SECONDS
                </div>
              </>
            )}

            {viewBattle.status === 'waiting' && !isCreator && (
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

            {canCancel && (
              <button className="form-submit" onClick={handleCancel} disabled={isSubmitting}>
                {isSubmitting ? 'PROCESSING...' : 'CANCEL BATTLE & RETURN STAKE'}
              </button>
            )}

            {canRefund && (
              <button className="form-submit" onClick={handleRefund} disabled={isSubmitting}>
                {isSubmitting ? 'PROCESSING...' : 'REFUND BOTH STAKES'}
              </button>
            )}

            {(viewBattle.status === 'finished' || viewBattle.status === 'settled') && viewBattle.winner && (
              <div className="result-section">
                <div className="result-trophy">🏆</div>
                <div className="result-winner-label">WINNER</div>
                <div className="result-winner-token">{viewBattle.winner}</div>
              </div>
            )}
                </>
              )
            })()}
          </>
        )}
      </Modal>
    </section>
  )
}
