import { useCallback, useMemo, useRef, useState } from 'react'
import { useConnectWallet, useLinkWithSiws, useLoginWithSiws, usePrivy } from '@privy-io/react-auth'
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

export function WalletProvider({ children }) {
  const { authenticated, getAccessToken, logout, ready: privyReady, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws()
  const { linkWithSiws } = useLinkWithSiws()
  const authenticationInFlight = useRef(false)
  const connectionInFlight = useRef(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const authenticateSolanaWallet = useCallback(async (solanaWallet) => {
    // Privy rejects a second SIWS login while the current session is active.
    // This also prevents a reconnect click from showing a false auth error.
    const alreadyLinked = user?.linkedAccounts?.some((linkedAccount) => (
      linkedAccount.type === 'wallet' && linkedAccount.address === solanaWallet.address
    ))
    if ((authenticated && alreadyLinked) || authenticationInFlight.current) return
    authenticationInFlight.current = true
    try {
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

      // A connected wallet can be new even when Privy restored an existing
      // session. In that case it must be linked, not used to log in again.
      if (authenticated) await linkWithSiws(credentials)
      else await loginWithSiws(credentials)
    } catch (error) {
      console.error('Solana wallet authentication failed', error)
      if (!isUserCancellation(error)) {
        const message = error instanceof Error ? error.message : 'The wallet signature could not be verified. Please try again.'
        notify('error', 'Wallet Authentication Failed', message)
      }
    } finally {
      authenticationInFlight.current = false
      connectionInFlight.current = false
      setIsConnecting(false)
    }
  }, [authenticated, generateSiwsMessage, linkWithSiws, loginWithSiws, user])

  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connectedWallet }) => {
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
  const activeWallet = wallets.find((connectedWallet) => user?.linkedAccounts?.some((linkedAccount) => (
    linkedAccount.type === 'wallet' && linkedAccount.address === connectedWallet.address
  )))

  const wallet = useMemo(() => ({
    connected: Boolean(authenticated && activeWallet),
    address: activeWallet?.address ?? '',
    balance: null,
    provider: activeWallet?.standardWallet?.name ?? null,
  }), [activeWallet, authenticated])

  const connect = useCallback(async () => {
    if (!privyReady) {
      notify('info', 'Wallet Loading', 'Privy is still preparing wallet connections')
      return
    }

    if ((authenticated && activeWallet) || connectionInFlight.current || authenticationInFlight.current) return

    connectionInFlight.current = true
    setIsConnecting(true)

    // Browser extension discovery can take longer in Opera. Privy can still
    // open its wallet selector while that discovery finishes, so do not block
    // a deliberate connection attempt on `walletsReady`.
    const connectedSolanaWallet = walletsReady
      ? (wallets.find((connectedWallet) => connectedWallet.chainType === 'solana') ?? wallets[0])
      : null
    if (connectedSolanaWallet) {
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
  }, [activeWallet, authenticated, authenticateSolanaWallet, connectWallet, privyReady, wallets, walletsReady])

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

  const depositStake = useCallback((lamports) => {
    if (!activeWallet) throw new Error('Connect a Solana wallet before depositing a stake.')
    return sendEscrowDeposit({ wallet: activeWallet, lamports, signAndSendTransaction })
  }, [activeWallet, signAndSendTransaction])

  const escrowConfigured = Boolean(import.meta.env.VITE_ESCROW_TREASURY_ADDRESS)

  return (
    <WalletContext.Provider value={{
      wallet,
      connect,
      disconnect,
      depositStake,
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
