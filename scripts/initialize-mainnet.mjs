import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'

const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value.trim()
}

const programId = new PublicKey(required('ESCROW_PROGRAM_ID'))
const feeTreasury = new PublicKey(required('ESCROW_FEE_TREASURY_ADDRESS'))
const settlementAuthority = new PublicKey(required('ESCROW_SETTLEMENT_AUTHORITY'))
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(required('SOLANA_MAINNET_OPERATOR_PATH'), 'utf8'))))
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed')
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
const [holderConfig] = PublicKey.findProgramAddressSync([Buffer.from('holder-config')], programId)

if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error('SOLANA_RPC_URL is not a Mainnet endpoint.')
if (!authority.publicKey.equals(settlementAuthority)) throw new Error('The initialized config admin must be the Mainnet settlement authority.')

const send = (instruction) => sendAndConfirmTransaction(connection, new Transaction().add(instruction), [authority], { commitment: 'confirmed' })
const output = { programId: programId.toBase58(), config: config.toBase58(), holderConfig: holderConfig.toBase58(), initializedConfig: false, initializedHolderConfig: false }

const existingConfig = await connection.getAccountInfo(config, 'confirmed')
if (!existingConfig) {
  output.initializeConfigSignature = await send(new TransactionInstruction({
    programId,
    data: Buffer.concat([discriminator('initialize_config'), feeTreasury.toBuffer(), settlementAuthority.toBuffer()]),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  }))
  output.initializedConfig = true
} else if (!existingConfig.owner.equals(programId)) {
  throw new Error('The Mainnet config PDA is owned by another program.')
}

const existingHolderConfig = await connection.getAccountInfo(holderConfig, 'confirmed')
if (!existingHolderConfig) {
  output.initializeHolderConfigSignature = await send(new TransactionInstruction({
    programId,
    data: discriminator('initialize_holder_config'),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: holderConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  }))
  output.initializedHolderConfig = true
} else if (!existingHolderConfig.owner.equals(programId)) {
  throw new Error('The Mainnet holder-config PDA is owned by another program.')
}

console.log(JSON.stringify(output))
