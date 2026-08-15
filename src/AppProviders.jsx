import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { WalletProvider, WalletUnavailableProvider } from './context/WalletContext'

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID

const privyConfig = {
  appearance: {
    showWalletLoginFirst: true,
    walletChainType: 'solana-only',
  },
  loginMethods: ['wallet'],
  externalWallets: {
    solana: {
      connectors: toSolanaWalletConnectors(),
    },
  },
}

export function AppProviders({ children }) {
  if (!privyAppId) return <WalletUnavailableProvider>{children}</WalletUnavailableProvider>

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <WalletProvider>{children}</WalletProvider>
    </PrivyProvider>
  )
}
