import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createNoopSigner,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'

const ESCROW_DESTINATION = import.meta.env.VITE_ESCROW_TREASURY_ADDRESS
const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

function requireEscrowDestination() {
  if (!ESCROW_DESTINATION) {
    throw new Error('Escrow is not configured yet. Add VITE_ESCROW_TREASURY_ADDRESS.')
  }
  return address(ESCROW_DESTINATION)
}

export async function buildEscrowDepositTransaction({ walletAddress, lamports }) {
  const source = address(walletAddress)
  const destination = requireEscrowDestination()
  // External wallets (Phantom/Solflare) sign locally and require a real
  // recent blockhash. A dummy blockhash only works when Privy's own API is
  // responsible for replacing it before signing.
  const { value: latestBlockhash } = await createSolanaRpc(RPC_URL).getLatestBlockhash().send()
  const instruction = getTransferSolInstruction({
    source: createNoopSigner(source),
    destination,
    amount: BigInt(lamports),
  })
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(source, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, value),
    (value) => appendTransactionMessageInstructions([instruction], value),
  )
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)))
}

export async function sendEscrowDeposit({ wallet, lamports, signAndSendTransaction }) {
  const transaction = await buildEscrowDepositTransaction({ walletAddress: wallet.address, lamports })
  const result = await signAndSendTransaction({
    transaction,
    wallet,
    chain: 'solana:mainnet',
  })
  return typeof result.signature === 'string'
    ? result.signature
    : getBase58Decoder().decode(result.signature)
}
