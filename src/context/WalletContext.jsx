import { useCallback, useMemo } from 'react'
import { useConnectWallet, useLoginWithSiws, usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { notify } from '../components/notificationService'
import { WalletContext } from './walletStore'

export function WalletProvider({ children }) {
  const { authenticated, getAccessToken, logout, ready: privyReady, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws()

  const authenticateSolanaWallet = useCallback(async (solanaWallet) => {
    try {
      const message = await generateSiwsMessage({ address: solanaWallet.address })
      const encodedMessage = new TextEncoder().encode(message)
      const { signature } = await solanaWallet.signMessage({ message: encodedMessage })
      await loginWithSiws({ signature, message })
    } catch (error) {
      console.error('Solana wallet authentication failed', error)
      notify('error', 'Wallet Authentication Failed', 'Approve the Phantom or Solflare signature request and try again.')
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

  return (
    <WalletContext.Provider value={{
      wallet,
      connect,
      disconnect,
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
    getAccessToken: async () => null,
    isReady: true,
    isConfigured: false,
  }), [connect])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
