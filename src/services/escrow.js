import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Encoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const ESCROW_DESTINATION = import.meta.env.VITE_ESCROW_TREASURY_ADDRESS

function requireEscrowDestination() {
  if (!ESCROW_DESTINATION) {
    throw new Error('Escrow is not configured yet. Add VITE_ESCROW_TREASURY_ADDRESS.')
  }
  return address(ESCROW_DESTINATION)
}

export async function buildEscrowDepositTransaction({ walletAddress, lamports }) {
  const source = address(walletAddress)
  const destination = requireEscrowDestination()
  const rpc = createSolanaRpc(RPC_URL)
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const instruction = getTransferSolInstruction({
    source: createNoopSigner(source),
    destination,
    amount: BigInt(lamports),
  })
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(source, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(blockhash, value),
    (value) => appendTransactionMessageInstructions([instruction], value),
  )
  return getTransactionEncoder().encode(compileTransaction(message))
}

export async function sendEscrowDeposit({ wallet, lamports, signAndSendTransaction }) {
  const transaction = await buildEscrowDepositTransaction({ walletAddress: wallet.address, lamports })
  const result = await signAndSendTransaction({
    transaction,
    wallet,
    chain: 'solana:mainnet',
  })
  return getBase58Encoder().encode(result.signature)
}
