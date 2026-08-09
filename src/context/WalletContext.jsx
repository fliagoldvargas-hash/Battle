import { useCallback, useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { notify } from '../components/notificationService'
import { WalletContext } from './walletStore'

export function WalletProvider({ children }) {
  const { connectWallet, logout, ready: privyReady } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const activeWallet = wallets[0]

  const wallet = useMemo(() => ({
    connected: Boolean(activeWallet),
    address: activeWallet?.address ?? '',
    balance: null,
    provider: activeWallet?.standardWallet?.name ?? null,
  }), [activeWallet])

  const connect = useCallback(() => {
    if (!privyReady || !walletsReady) {
      notify('info', 'Wallet Loading', 'Privy is still preparing wallet connections')
      return
    }

    connectWallet({ walletList: ['phantom', 'solflare'] })
  }, [connectWallet, privyReady, walletsReady])

  const disconnect = useCallback(async () => {
    await logout()
    notify('info', 'Wallet Disconnected', 'Your Privy session has been closed')
  }, [logout])

  return (
    <WalletContext.Provider value={{
      wallet,
      connect,
      disconnect,
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
    isReady: true,
    isConfigured: false,
  }), [connect])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
