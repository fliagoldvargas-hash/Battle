import { useCallback, useMemo } from 'react'
import { useConnectWallet, useLoginWithSiws, usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { notify } from '../components/notificationService'
import { WalletContext } from './walletStore'
import { sendEscrowDeposit } from '../services/escrow'

function signatureToBase64(signature) {
  if (typeof signature === 'string') return signature

  const binary = Array.from(signature, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

export function WalletProvider({ children }) {
  const { authenticated, getAccessToken, logout, ready: privyReady, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws()

  const authenticateSolanaWallet = useCallback(async (solanaWallet) => {
    try {
      const message = await generateSiwsMessage({ address: solanaWallet.address })
      const encodedMessage = new TextEncoder().encode(message)
      const { signature } = await solanaWallet.signMessage({ message: encodedMessage })
      await loginWithSiws({
        signature: signatureToBase64(signature),
        message,
      })
    } catch (error) {
      console.error('Solana wallet authentication failed', error)
      const message = error instanceof Error ? error.message : 'The wallet signature could not be verified. Please try again.'
      notify('error', 'Wallet Authentication Failed', message)
    }
  }, [generateSiwsMessage, loginWithSiws])

  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connectedWallet }) => {
      void authenticateSolanaWallet(connectedWallet)
    },
    onError: () => {
      notify('error', 'Wallet Connection Failed', 'Could not connect your Solana wallet. Please try again.')
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

  const connect = useCallback(() => {
    if (!privyReady || !walletsReady) {
      notify('info', 'Wallet Loading', 'Privy is still preparing wallet connections')
      return
    }

    const connectedSolanaWallet = wallets[0]
    if (connectedSolanaWallet) {
      void authenticateSolanaWallet(connectedSolanaWallet)
      return
    }

    connectWallet({
      walletList: ['phantom', 'solflare'],
      walletChainType: 'solana-only',
    })
  }, [authenticateSolanaWallet, connectWallet, privyReady, wallets, walletsReady])

  const disconnect = useCallback(async () => {
    await logout()
    notify('info', 'Wallet Disconnected', 'Your Privy session has been closed')
  }, [logout])

  const depositStake = useCallback((lamports) => {
    if (!activeWallet) throw new Error('Connect a Solana wallet before depositing a stake.')
    return sendEscrowDeposit({ wallet: activeWallet, lamports })
  }, [activeWallet])

  const escrowConfigured = Boolean(import.meta.env.VITE_ESCROW_TREASURY_ADDRESS)

  return (
    <WalletContext.Provider value={{
      wallet,
      connect,
      disconnect,
      depositStake,
      escrowConfigured,
      getAccessToken,
      isReady: privyReady && walletsReady,
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
    getAccessToken: async () => null,
    isReady: true,
    isConfigured: false,
  }), [connect])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
