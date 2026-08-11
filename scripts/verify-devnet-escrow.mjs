import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const programId = new PublicKey(required('ESCROW_PROGRAM_ID'))
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(required('SOLANA_DEVNET_AUTHORITY_PATH'), 'utf8'))))
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed')
const stakeLamports = Math.round(0.01 * LAMPORTS_PER_SOL)

const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const u64 = (value) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes
}
const u32 = (value) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}
const accounts = (id) => {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const [battle] = PublicKey.findProgramAddressSync([Buffer.from('battle'), id], programId)
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBuffer()], programId)
  return { config, battle, vault }
}
const send = async (instruction, signers) => sendAndConfirmTransaction(connection, new Transaction().add(instruction), signers, { commitment: 'confirmed' })
const create = async (creator, id, token) => {
  const { config, battle, vault } = accounts(id)
  const data = Buffer.concat([discriminator('create_battle'), id, token.toBuffer(), u64(stakeLamports), u32(1800)])
  const signature = await send(new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  }), [creator])
  return { signature, battle, vault }
}

const cancelId = randomBytes(16)
const cancelled = await create(authority, cancelId, Keypair.generate().publicKey)
const vaultBeforeCancel = await connection.getBalance(cancelled.vault, 'confirmed')
if (vaultBeforeCancel < stakeLamports) throw new Error('Creator stake was not deposited into the vault.')
const cancelSignature = await send(new TransactionInstruction({
  programId,
  data: discriminator('cancel_waiting'),
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: cancelled.battle, isSigner: false, isWritable: true },
    { pubkey: cancelled.vault, isSigner: false, isWritable: true },
  ],
}), [authority])
if (await connection.getAccountInfo(cancelled.battle, 'confirmed')) throw new Error('Cancelled battle account was not closed.')
if (await connection.getAccountInfo(cancelled.vault, 'confirmed')) throw new Error('Cancelled vault account was not closed.')

const opponent = Keypair.generate()
const funding = new Transaction().add(SystemProgram.transfer({
  fromPubkey: authority.publicKey,
  toPubkey: opponent.publicKey,
  lamports: Math.round(0.05 * LAMPORTS_PER_SOL),
}))
await sendAndConfirmTransaction(connection, funding, [authority], { commitment: 'confirmed' })

const activeId = randomBytes(16)
const active = await create(authority, activeId, Keypair.generate().publicKey)
const joinSignature = await send(new TransactionInstruction({
  programId,
  data: Buffer.concat([discriminator('join_battle'), Keypair.generate().publicKey.toBuffer()]),
  keys: [
    { pubkey: opponent.publicKey, isSigner: true, isWritable: true },
    { pubkey: active.battle, isSigner: false, isWritable: true },
    { pubkey: active.vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
}), [opponent])
const activeAccount = await connection.getAccountInfo(active.battle, 'confirmed')
if (!activeAccount || activeAccount.owner.toBase58() !== programId.toBase58() || activeAccount.data[180] !== 1) {
  throw new Error('Joined battle did not reach the active on-chain state.')
}
const activeVaultBalance = await connection.getBalance(active.vault, 'confirmed')
if (activeVaultBalance < stakeLamports * 2) throw new Error('Joined battle vault does not contain both stakes.')

const refundTransaction = new Transaction().add(new TransactionInstruction({
  programId,
  data: discriminator('refund_expired'),
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: authority.publicKey, isSigner: false, isWritable: true },
    { pubkey: opponent.publicKey, isSigner: false, isWritable: true },
    { pubkey: active.battle, isSigner: false, isWritable: true },
    { pubkey: active.vault, isSigner: false, isWritable: true },
  ],
}))
refundTransaction.feePayer = authority.publicKey
refundTransaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
refundTransaction.sign(authority)
const simulatedRefund = await connection.simulateTransaction(refundTransaction)
if (!simulatedRefund.value.err || !(simulatedRefund.value.logs || []).some((line) => line.includes('technical refund window has not opened'))) {
  throw new Error('The active battle did not enforce its on-chain refund delay.')
}

console.log(JSON.stringify({
  cancelCreateSignature: cancelled.signature,
  cancelSignature,
  joinCreateSignature: active.signature,
  joinSignature,
  activeBattle: active.battle.toBase58(),
  activeVault: active.vault.toBase58(),
  activeBattleId: activeId.toString('hex'),
  opponent: opponent.publicKey.toBase58(),
  vaultBeforeCancel,
  activeVaultBalance,
  refundDelayGuard: 'verified',
}))
