import React from 'react'
import ReactDOM from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import App from './App.jsx'
import { WalletProvider, WalletUnavailableProvider } from './context/WalletContext'
import './index.css'

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

function Providers({ children }) {
  if (!privyAppId) {
    return <WalletUnavailableProvider>{children}</WalletUnavailableProvider>
  }

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <WalletProvider>{children}</WalletProvider>
    </PrivyProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
)
