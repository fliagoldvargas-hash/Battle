const explorerQuery = (network) => (network === 'devnet' ? '?cluster=devnet' : '')

export const solanaExplorerAddress = (address, network) => {
  if (!address) return null
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}${explorerQuery(network)}`
}

export const solanaExplorerTransaction = (signature, network) => {
  if (!signature || signature.startsWith('oracle-pending:') || signature.startsWith('pending:')) return null
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${explorerQuery(network)}`
}

export const transactionSignatures = (signatures) => (
  typeof signatures === 'string'
    ? signatures.split(',').map((signature) => signature.trim()).filter(Boolean)
    : []
)
