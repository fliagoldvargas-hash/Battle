import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase58Encoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'

const ESCROW_DESTINATION = import.meta.env.VITE_ESCROW_TREASURY_ADDRESS
// Privy can replace this sentinel with a fresh mainnet blockhash immediately
// before signing. This avoids sending a transaction with a stale blockhash
// when the user leaves the wallet modal open.
const PRIVY_BLOCKHASH = '11111111111111111111111111111111'

function requireEscrowDestination() {
  if (!ESCROW_DESTINATION) {
    throw new Error('Escrow is not configured yet. Add VITE_ESCROW_TREASURY_ADDRESS.')
  }
  return address(ESCROW_DESTINATION)
}

export async function buildEscrowDepositTransaction({ walletAddress, lamports }) {
  const source = address(walletAddress)
  const destination = requireEscrowDestination()
  const instruction = getTransferSolInstruction({
    source: createNoopSigner(source),
    destination,
    amount: BigInt(lamports),
  })
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(source, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: PRIVY_BLOCKHASH, lastValidBlockHeight: 0n }, value),
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
    : getBase58Encoder().encode(result.signature)
}
