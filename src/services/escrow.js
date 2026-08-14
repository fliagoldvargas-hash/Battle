import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
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

function requireEscrowDestination() {
  if (!ESCROW_DESTINATION) {
    throw new Error('Escrow is not configured yet. Add VITE_ESCROW_TREASURY_ADDRESS.')
  }
  return address(ESCROW_DESTINATION)
}

function requireRecentBlockhash(recentBlockhash) {
  const blockhash = recentBlockhash?.blockhash
  const lastValidBlockHeight = Number(recentBlockhash?.lastValidBlockHeight)

  if (typeof blockhash !== 'string' || !blockhash || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 1) {
    throw new Error('The deposit transaction could not be prepared. Please try creating the battle again.')
  }

  return { blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }
}

export async function buildEscrowDepositTransaction({ walletAddress, lamports, recentBlockhash }) {
  const source = address(walletAddress)
  const destination = requireEscrowDestination()
  // The server obtains this immediately before returning the deposit intent.
  // Keeping the RPC call out of the browser prevents public-RPC CORS/rate-limit
  // errors from aborting the wallet prompt before Phantom/Solflare can sign.
  const latestBlockhash = requireRecentBlockhash(recentBlockhash)
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

export async function sendEscrowDeposit({ wallet, lamports, recentBlockhash, signAndSendTransaction }) {
  const transaction = await buildEscrowDepositTransaction({ walletAddress: wallet.address, lamports, recentBlockhash })
  const result = await signAndSendTransaction({
    transaction,
    wallet,
    chain: 'solana:mainnet',
  })
  return typeof result.signature === 'string'
    ? result.signature
    : getBase58Decoder().decode(result.signature)
}
