import { useState, useCallback } from 'react'
import { notify } from '../components/notificationService'
import { WalletContext } from './walletStore'

const MOCK_WALLETS = [
  { name: 'Phantom', icon: '👻', desc: 'Most popular Solana wallet' },
  { name: 'Solflare', icon: '🔆', desc: 'Feature-rich Solana wallet' },
  { name: 'Backpack', icon: '🎒', desc: 'Multi-chain wallet by xNFT' },
]

export function WalletProvider({ children }) {
  const [wallet, setWallet] = useState({
    connected: false,
    address: '',
    balance: 0,
    provider: null,
  })

  const connect = useCallback((providerName = 'Phantom') => {
    // Mock wallet connection — will be replaced with @solana/wallet-adapter-react
    const mockAddress = 'TBat' + Array.from({ length: 8 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'[
        Math.floor(Math.random() * 58)
      ]
    ).join('') + '...'
    
    setWallet({
      connected: true,
      address: mockAddress.slice(0, 4) + mockAddress.slice(4, 8) + Array.from({length: 36}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'[Math.floor(Math.random()*58)]).join(''),
      balance: (Math.random() * 50 + 5).toFixed(2),
      provider: providerName,
    })
    notify('success', 'Wallet Connected', `Connected via ${providerName}`)
  }, [])

  const disconnect = useCallback(() => {
    setWallet({ connected: false, address: '', balance: 0, provider: null })
    notify('info', 'Wallet Disconnected', 'Your wallet has been disconnected')
  }, [])

  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect, MOCK_WALLETS }}>
      {children}
    </WalletContext.Provider>
  )
}
