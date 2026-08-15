import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const programId = new PublicKey(required('ESCROW_PROGRAM_ID'))
const authorityPath = required('SOLANA_DEVNET_AUTHORITY_PATH')
const feeTreasury = new PublicKey(required('ESCROW_DEVNET_FEE_TREASURY'))
const settlementAuthority = new PublicKey(required('ESCROW_DEVNET_SETTLEMENT_AUTHORITY'))
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(authorityPath, 'utf8'))))
const connection = new Connection(rpcUrl, 'confirmed')
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)

const existing = await connection.getAccountInfo(config, 'confirmed')
if (existing) {
  if (!existing.owner.equals(programId)) throw new Error('The Devnet config address is owned by another program.')
  console.log(JSON.stringify({ initialized: true, config: config.toBase58() }))
  process.exit(0)
}

const discriminator = createHash('sha256').update('global:initialize_config').digest().subarray(0, 8)
const instruction = new TransactionInstruction({
  programId,
  data: Buffer.concat([discriminator, feeTreasury.toBuffer(), settlementAuthority.toBuffer()]),
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
})

const transaction = new Transaction().add(instruction)
transaction.feePayer = authority.publicKey
transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
const signature = await connection.sendTransaction(transaction, [authority], { commitment: 'confirmed' })
await connection.confirmTransaction(signature, 'confirmed')
console.log(JSON.stringify({ initialized: true, config: config.toBase58(), signature }))
