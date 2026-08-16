import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnectWallet, useLoginWithSiws, usePrivy } from '@privy-io/react-auth'
import { useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana'
import { notify } from '../components/notificationService'
import { WalletContext } from './walletStore'
import { sendEscrowDeposit } from '../services/escrow'

function signatureToBase64(signature) {
  if (typeof signature === 'string') return signature

  const binary = Array.from(signature, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

function isUserCancellation(error) {
  return /cancel|reject|declin|clos(ed|ing)/i.test(error instanceof Error ? error.message : String(error ?? ''))
}

function walletErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/invalid siws message.*nonce/i.test(message)) {
    return 'The sign-in message expired before it could be verified. Click Connect Wallet and approve the new signature.'
  }
  if (/already authenticated/i.test(message)) {
    return 'Your wallet session is already active. Please try the connection again.'
  }
  return message || 'The wallet signature could not be verified. Please try again.'
}

function addressFromWalletAccount(account) {
  if (!account) return ''
  if (typeof account === 'string') return account
  if (typeof account.address === 'string') return account.address
  if (typeof account.toBase58 === 'function') return account.toBase58()
  return ''
}

function liveAddressForWallet(solanaWallet, accounts) {
  const accountList = Array.isArray(accounts) ? accounts : solanaWallet?.standardWallet?.accounts
  return addressFromWalletAccount(solanaWallet?.provider?.publicKey)
    || addressFromWalletAccount(accountList?.[0])
    || solanaWallet?.address
    || ''
}

export function WalletProvider({ children }) {
  const { authenticated, getAccessToken, logout, ready: privyReady, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws()
  const authenticationInFlight = useRef(false)
  const connectionInFlight = useRef(false)
  const sessionInvalidationInFlight = useRef(false)
  const [isConnecting, setIsConnecting] = useState(false)
  // Privy can expose more than one linked Solana wallet in the same browser.
  // Keep the last wallet deliberately selected by the user; selecting the
  // first linked wallet made a second wallet appear connected while the app
  // still attempted a battle action with the creator's address.
  const [selectedWalletAddress, setSelectedWalletAddress] = useState('')
  const [sessionWalletAddress, setSessionWalletAddress] = useState('')
  const [liveWalletAddress, setLiveWalletAddress] = useState('')

  const invalidateWalletSession = useCallback(async () => {
    if (sessionInvalidationInFlight.current) return

    sessionInvalidationInFlight.current = true
    setSelectedWalletAddress('')
    setSessionWalletAddress('')
    notify('info', 'Wallet Changed', 'Phantom or Solflare switched accounts. Reconnect the active wallet before creating or joining a battle.')
    try {
      await logout()
    } catch (error) {
      console.warn('Unable to close the previous Privy session after a wallet change.', error)
    } finally {
      sessionInvalidationInFlight.current = false
    }
  }, [logout])

  const authenticateSolanaWallet = useCallback(async (solanaWallet) => {
    // Token Battle intentionally uses one wallet per session. Linking a second
    // wallet can fail when it belongs to another Privy user, so switching
    // wallets always starts a fresh SIWS login instead.
    const alreadyLinked = user?.linkedAccounts?.some((linkedAccount) => (
      linkedAccount.type === 'wallet' && linkedAccount.address === solanaWallet.address
    ))
    if (authenticationInFlight.current) return
    if (authenticated && alreadyLinked) {
      setSelectedWalletAddress(solanaWallet.address)
      setSessionWalletAddress(solanaWallet.address)
      connectionInFlight.current = false
      setIsConnecting(false)
      return
    }
    authenticationInFlight.current = true
    try {
      if (authenticated) {
        await logout()
        setSelectedWalletAddress('')
        setSessionWalletAddress('')
      }
      const message = await generateSiwsMessage({ address: solanaWallet.address })
      const encodedMessage = new TextEncoder().encode(message)
      // Privy returns a standard Solana wallet after it has finished connecting.
      // Older connector descriptors expose the same signer through `provider`.
      const signingWallet = typeof solanaWallet.signMessage === 'function'
        ? solanaWallet
        : solanaWallet.provider
      if (!signingWallet || typeof signingWallet.signMessage !== 'function') {
        throw new Error('The connected Solana wallet cannot sign messages yet. Please reconnect it.')
      }
      const { signature } = await signingWallet.signMessage({ message: encodedMessage })
      const credentials = {
        signature: signatureToBase64(signature),
        message,
        walletClientType: solanaWallet.walletClientType,
        connectorType: solanaWallet.connectorType,
      }

      await loginWithSiws(credentials)
      setSelectedWalletAddress(solanaWallet.address)
      setSessionWalletAddress(solanaWallet.address)
    } catch (error) {
      console.error('Solana wallet authentication failed', error)
      if (!isUserCancellation(error)) {
        notify('error', 'Wallet Authentication Failed', walletErrorMessage(error))
      }
    } finally {
      authenticationInFlight.current = false
      connectionInFlight.current = false
      setIsConnecting(false)
    }
  }, [authenticated, generateSiwsMessage, loginWithSiws, logout, user])

  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connectedWallet }) => {
      setSelectedWalletAddress(connectedWallet.address)
      void authenticateSolanaWallet(connectedWallet)
    },
    onError: (error) => {
      connectionInFlight.current = false
      setIsConnecting(false)
      if (!isUserCancellation(error)) {
        notify('error', 'Wallet Connection Failed', 'Could not connect your Solana wallet. Please try again.')
      }
    },
  })
  const activeWallet = useMemo(() => {
    const linkedWallets = wallets.filter((connectedWallet) => user?.linkedAccounts?.some((linkedAccount) => (
      linkedAccount.type === 'wallet' && linkedAccount.address === connectedWallet.address
    )))
    return linkedWallets.find((connectedWallet) => connectedWallet.address === selectedWalletAddress) ?? linkedWallets[0]
  }, [selectedWalletAddress, user, wallets])

  useEffect(() => {
    if (!activeWallet) {
      setLiveWalletAddress('')
      return undefined
    }

    const standardWallet = activeWallet.standardWallet
    const updateActiveAccount = (accounts) => {
      const nextAddress = liveAddressForWallet(activeWallet, accounts)
      setLiveWalletAddress(nextAddress)
      if (authenticated && sessionWalletAddress && nextAddress && nextAddress !== sessionWalletAddress) {
        void invalidateWalletSession()
      }
    }

    updateActiveAccount(standardWallet?.accounts)

    const cleanups = []
    const events = standardWallet?.features?.['standard:events']
    if (events && typeof events.on === 'function') {
      cleanups.push(events.on('change', ({ accounts }) => updateActiveAccount(accounts)))
    }

    const provider = activeWallet.provider
    if (provider && typeof provider.on === 'function') {
      const onAccountChanged = (account) => updateActiveAccount(account ? [account] : [])
      provider.on('accountChanged', onAccountChanged)
      cleanups.push(() => {
        if (typeof provider.removeListener === 'function') provider.removeListener('accountChanged', onAccountChanged)
      })
    }

    return () => cleanups.forEach((cleanup) => cleanup?.())
  }, [activeWallet, authenticated, invalidateWalletSession, sessionWalletAddress])

  const currentWalletAddress = liveWalletAddress || activeWallet?.address || ''

  const ensureWalletSession = useCallback(() => {
    if (!authenticated || !activeWallet || !sessionWalletAddress || currentWalletAddress !== sessionWalletAddress) {
      void invalidateWalletSession()
      throw new Error('The active wallet account changed. Reconnect the wallet before creating or joining a battle.')
    }
    return activeWallet
  }, [activeWallet, authenticated, currentWalletAddress, invalidateWalletSession, sessionWalletAddress])

  const wallet = useMemo(() => ({
    connected: Boolean(authenticated && activeWallet && sessionWalletAddress && currentWalletAddress === sessionWalletAddress),
    address: sessionWalletAddress,
    balance: null,
    provider: activeWallet?.standardWallet?.name ?? null,
  }), [activeWallet, authenticated, currentWalletAddress, sessionWalletAddress])

  const connect = useCallback(async () => {
    if (!privyReady) {
      notify('info', 'Wallet Loading', 'Privy is still preparing wallet connections')
      return
    }

    const sessionMatchesActiveWallet = Boolean(
      authenticated
      && activeWallet
      && sessionWalletAddress
      && currentWalletAddress === sessionWalletAddress,
    )
    if (sessionMatchesActiveWallet || connectionInFlight.current || authenticationInFlight.current || sessionInvalidationInFlight.current) return

    connectionInFlight.current = true
    setIsConnecting(true)

    // Browser extension discovery can take longer in Opera. Privy can still
    // open its wallet selector while that discovery finishes, so do not block
    // a deliberate connection attempt on `walletsReady`.
    const connectedSolanaWallet = walletsReady
      ? (wallets.find((connectedWallet) => connectedWallet.chainType === 'solana') ?? wallets[0])
      : null
    if (connectedSolanaWallet) {
      setSelectedWalletAddress(connectedSolanaWallet.address)
      void authenticateSolanaWallet(connectedSolanaWallet)
      return
    }

    try {
      await connectWallet({
        walletList: ['phantom', 'solflare'],
        walletChainType: 'solana-only',
      })
    } catch (error) {
      connectionInFlight.current = false
      setIsConnecting(false)
      if (!isUserCancellation(error)) {
        notify('error', 'Wallet Connection Failed', 'Could not open the Solana wallet selector. Please try again.')
      }
    }
  }, [activeWallet, authenticated, authenticateSolanaWallet, connectWallet, currentWalletAddress, privyReady, sessionWalletAddress, wallets, walletsReady])

  const disconnect = useCallback(async () => {
    if (connectionInFlight.current || authenticationInFlight.current) return

    connectionInFlight.current = true
    setIsConnecting(true)
    try {
      // Closing the Privy session alone leaves Phantom/Solflare marked as
      // connected in this browser. Disconnect both layers before the next login.
      if (typeof activeWallet?.disconnect === 'function') await activeWallet.disconnect()
    } catch (error) {
      console.warn('External wallet disconnect failed; closing Privy session anyway.', error)
    } finally {
      try {
        await logout()
        setSelectedWalletAddress('')
        setSessionWalletAddress('')
        notify('info', 'Wallet Disconnected', 'Your Privy session and wallet connection have been closed')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not close your Privy session. Please try again.'
        notify('error', 'Wallet Disconnect Failed', message)
      } finally {
        connectionInFlight.current = false
        setIsConnecting(false)
      }
    }
  }, [activeWallet, logout])

  const depositStake = useCallback((lamports, recentBlockhash) => {
    const currentWallet = ensureWalletSession()
    if (typeof currentWallet.signAndSendTransaction !== 'function') {
      throw new Error('Your connected wallet cannot send Solana transactions. Disconnect it and connect Phantom or Solflare again.')
    }

    // Deposits from Phantom/Solflare must use the standard-wallet method on
    // the external wallet itself. Routing them through Privy's generic hook
    // can open Privy's internal transaction UI instead of the extension and
    // leave Opera on a black overlay before any signature request is shown.
    return sendEscrowDeposit({
      wallet: currentWallet,
      lamports,
      recentBlockhash,
      signAndSendTransaction: ({ transaction, chain }) => currentWallet.signAndSendTransaction({ transaction, chain }),
    })
  }, [ensureWalletSession])

  const escrowConfigured = Boolean(import.meta.env.VITE_ESCROW_TREASURY_ADDRESS)

  return (
    <WalletContext.Provider value={{
      wallet,
      connect,
      disconnect,
      depositStake,
      ensureWalletSession,
      escrowConfigured,
      solanaWallet: activeWallet,
      signAndSendSolanaTransaction: signAndSendTransaction,
      getAccessToken,
      isReady: privyReady,
      isConnecting,
      isConfigured: true,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

export function WalletUnavailableProvider({ children }) {
  const connect = useCallback(() => {
    notify('error', 'Privy Not Configured', 'Add VITE_PRIVY_APP_ID to connect a wallet locally')
  }, [])

  const value = useMemo(() => ({
    wallet: { connected: false, address: '', balance: null, provider: null },
    connect,
    disconnect: () => {},
    depositStake: async () => { throw new Error('Privy is not configured.') },
    ensureWalletSession: () => { throw new Error('Privy is not configured.') },
    escrowConfigured: false,
    solanaWallet: null,
    signAndSendSolanaTransaction: async () => { throw new Error('Privy is not configured.') },
    getAccessToken: async () => null,
    isReady: true,
    isConnecting: false,
    isConfigured: false,
  }), [connect])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
