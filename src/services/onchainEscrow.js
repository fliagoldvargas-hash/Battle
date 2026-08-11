import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'

const PROGRAM_ID = import.meta.env.VITE_ESCROW_PROGRAM_ID
const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const DEVNET = import.meta.env.VITE_BATTLE_NETWORK === 'devnet'

function requireProgram() {
  if (!DEVNET) throw new Error('The on-chain escrow is only enabled in the Devnet preview.')
  if (!PROGRAM_ID) throw new Error('Devnet escrow is not configured yet.')
  return new PublicKey(PROGRAM_ID)
}

function discriminator(name) {
  const bytes = new TextEncoder().encode(`global:${name}`)
  // Anchor instruction discriminators are the first eight bytes of SHA-256.
  return crypto.subtle.digest('SHA-256', bytes).then((hash) => new Uint8Array(hash).slice(0, 8))
}

function u64(value) {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true)
  return out
}

function u32(value) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, Number(value), true)
  return out
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function randomBattleId() {
  const id = new Uint8Array(16)
  crypto.getRandomValues(id)
  return id
}

function bytesFromHex(hex) {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid Devnet battle identifier.')
  return Uint8Array.from(hex.match(/.{1,2}/g), (pair) => Number.parseInt(pair, 16))
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function deriveAccounts(id) {
  const programId = requireProgram()
  const [config] = PublicKey.findProgramAddressSync([new TextEncoder().encode('config')], programId)
  const [battle] = PublicKey.findProgramAddressSync([new TextEncoder().encode('battle'), id], programId)
  const [vault] = PublicKey.findProgramAddressSync([new TextEncoder().encode('vault'), battle.toBytes()], programId)
  return { programId, config, battle, vault }
}

async function send({ wallet, signAndSendTransaction, instruction }) {
  const connection = new Connection(RPC_URL, 'confirmed')
  const transaction = new Transaction().add(instruction)
  transaction.feePayer = new PublicKey(wallet.address)
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  const result = await signAndSendTransaction({
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    wallet,
    chain: 'solana:devnet',
  })
  return typeof result.signature === 'string' ? result.signature : Buffer.from(result.signature).toString('base64')
}

export async function createOnchainBattle({ wallet, signAndSendTransaction, tokenMint, stakeLamports, durationSeconds }) {
  const id = randomBattleId()
  const { programId, config, battle, vault } = deriveAccounts(id)
  const data = concat(await discriminator('create_battle'), id, new PublicKey(tokenMint).toBytes(), u64(stakeLamports), u32(durationSeconds))
  const instruction = new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
  const signature = await send({ wallet, signAndSendTransaction, instruction })
  return { signature, battleAddress: battle.toBase58(), vaultAddress: vault.toBase58(), battleId: hexFromBytes(id) }
}

export async function joinOnchainBattle({ wallet, signAndSendTransaction, battleIdHex, tokenMint }) {
  const id = bytesFromHex(battleIdHex)
  const { programId, battle, vault } = deriveAccounts(id)
  const data = concat(await discriminator('join_battle'), new PublicKey(tokenMint).toBytes())
  const instruction = new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: true },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
  const signature = await send({ wallet, signAndSendTransaction, instruction })
  return { signature, battleAddress: battle.toBase58(), vaultAddress: vault.toBase58() }
}

export const isOnchainEscrowEnabled = () => DEVNET && Boolean(PROGRAM_ID)
