import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'

const PROGRAM_ID = import.meta.env.VITE_ESCROW_PROGRAM_ID
const NETWORK = import.meta.env.VITE_BATTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || (NETWORK === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com')
const CHAIN = `solana:${NETWORK}`
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'Mainnet' : 'Devnet'
const EMPTY_PUBLIC_KEY = '11111111111111111111111111111111'

function requireProgram() {
  if (!PROGRAM_ID) throw new Error('The on-chain escrow is not configured yet.')
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

function u16(value) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, Number(value), true)
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
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid on-chain battle identifier.')
  return Uint8Array.from(hex.match(/.{1,2}/g), (pair) => Number.parseInt(pair, 16))
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8
      digits[index] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let output = ''
  for (const byte of bytes) {
    if (byte !== 0) break
    output += alphabet[0]
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) output += alphabet[digits[index]]
  return output
}

function deriveAccounts(id) {
  const programId = requireProgram()
  const [config] = PublicKey.findProgramAddressSync([new TextEncoder().encode('config')], programId)
  const [holderConfig] = PublicKey.findProgramAddressSync([new TextEncoder().encode('holder-config')], programId)
  const [battle] = PublicKey.findProgramAddressSync([new TextEncoder().encode('battle'), id], programId)
  const [vault] = PublicKey.findProgramAddressSync([new TextEncoder().encode('vault'), battle.toBytes()], programId)
  return { programId, config, holderConfig, battle, vault }
}

function walletTransactionError(error) {
  const message = error instanceof Error
    ? error.message
    : error?.message ?? error?.error?.message ?? error?.reason
  if (message && String(message).trim()) return String(message)
  return `The connected wallet did not complete the ${NETWORK_LABEL} transaction. Approve the transaction in your wallet and try again.`
}

async function send({ wallet, signAndSendTransaction, instruction }) {
  try {
    const connection = new Connection(RPC_URL, 'confirmed')
    const transaction = new Transaction().add(instruction)
    transaction.feePayer = new PublicKey(wallet.address)
    transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
    const result = await signAndSendTransaction({
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      wallet,
      chain: CHAIN,
    })
    if (typeof result.signature === 'string') return result.signature
    if (result.signature instanceof Uint8Array) return base58Encode(result.signature)
    throw new Error('Wallet did not return a Solana transaction signature.')
  } catch (error) {
    console.error('On-chain escrow transaction failed', error)
    throw new Error(walletTransactionError(error))
  }
}

function accountBytes(account) {
  if (account?.data instanceof Uint8Array) return account.data
  if (Array.isArray(account?.data)) return Uint8Array.from(account.data)
  throw new Error('The Solana RPC returned an unreadable account.')
}

function pubkeyAt(bytes, offset) {
  return new PublicKey(bytes.slice(offset, offset + 32)).toBase58()
}

function readU64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
}

function decodeHolderConfig(account) {
  const bytes = accountBytes(account)
  if (bytes.length < 84) throw new Error('The holder fee configuration is invalid on-chain.')
  return {
    initialized: true,
    holderMint: pubkeyAt(bytes, 8),
    decimals: bytes[40],
    tierMinimums: [readU64(bytes, 41), readU64(bytes, 49), readU64(bytes, 57), readU64(bytes, 65)],
    feeBps: [
      new DataView(bytes.buffer, bytes.byteOffset + 73, 2).getUint16(0, true),
      new DataView(bytes.buffer, bytes.byteOffset + 75, 2).getUint16(0, true),
      new DataView(bytes.buffer, bytes.byteOffset + 77, 2).getUint16(0, true),
      new DataView(bytes.buffer, bytes.byteOffset + 79, 2).getUint16(0, true),
      new DataView(bytes.buffer, bytes.byteOffset + 81, 2).getUint16(0, true),
    ],
  }
}

function defaultHolderConfig() {
  return {
    initialized: false,
    holderMint: EMPTY_PUBLIC_KEY,
    decimals: 0,
    tierMinimums: [1_000n, 10_000n, 100_000n, 1_000_000n],
    feeBps: [100, 75, 50, 25, 10],
  }
}

export function formatFeePercent(feeBps) {
  return `${(Number(feeBps) / 100).toFixed(Number(feeBps) % 100 === 0 ? 0 : 2)}%`
}

export function rawTokenAmount(value, decimals) {
  const normalized = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Enter a valid holder-token amount.')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`)
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`)
}

export function displayTokenAmount(raw, decimals) {
  const value = BigInt(raw)
  if (!decimals) return value.toString()
  const padded = value.toString().padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export async function getHolderFeeConfig() {
  const { holderConfig } = deriveAccounts(new Uint8Array(16))
  const connection = new Connection(RPC_URL, 'confirmed')
  const account = await connection.getAccountInfo(holderConfig, 'confirmed')
  return account ? decodeHolderConfig(account) : defaultHolderConfig()
}

export async function getOnchainStatus() {
  const response = await fetch('/api/onchain-status')
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'The on-chain escrow status is unavailable.')
  return result
}

export async function getEscrowAdmin() {
  const { config } = deriveAccounts(new Uint8Array(16))
  const connection = new Connection(RPC_URL, 'confirmed')
  const account = await connection.getAccountInfo(config, 'confirmed')
  const bytes = accountBytes(account)
  if (bytes.length < 40) throw new Error('The escrow configuration is invalid on-chain.')
  return pubkeyAt(bytes, 8)
}

async function holderAccountsForWallet(walletAddress, holderConfig) {
  if (!holderConfig.initialized || holderConfig.holderMint === EMPTY_PUBLIC_KEY) return { balance: 0n, accounts: [] }
  const connection = new Connection(RPC_URL, 'confirmed')
  const response = await connection.getTokenAccountsByOwner(new PublicKey(walletAddress), { mint: new PublicKey(holderConfig.holderMint) }, 'confirmed')
  const accounts = response.value.map((item) => item.pubkey)
  const balance = response.value.reduce((total, item) => total + readU64(accountBytes(item.account), 64), 0n)
  return { balance, accounts }
}

export async function getHolderFeeQuote(walletAddress) {
  const config = await getHolderFeeConfig()
  const holding = await holderAccountsForWallet(walletAddress, config)
  let feeBps = config.feeBps[0]
  if (config.initialized && config.holderMint !== EMPTY_PUBLIC_KEY) {
    for (let index = config.tierMinimums.length - 1; index >= 0; index -= 1) {
      if (holding.balance >= config.tierMinimums[index]) {
        feeBps = config.feeBps[index + 1]
        break
      }
    }
  }
  return { ...config, ...holding, feeBps }
}

export async function holderMintDecimals(mint) {
  let publicKey
  try {
    publicKey = new PublicKey(String(mint).trim())
  } catch {
    throw new Error('Enter a valid Solana token CA.')
  }
  const connection = new Connection(RPC_URL, 'confirmed')
  const account = await connection.getAccountInfo(publicKey, 'confirmed')
  if (!account) throw new Error(`This CA does not exist on Solana ${NETWORK_LABEL}. Use an initialized SPL token mint on this network.`)
  const bytes = accountBytes(account)
  const owner = account?.owner?.toBase58()
  const supportedTokenPrograms = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdYhQPLqP2K1gSN3JwzQfE6VTMZqcxAmVR2qj'])
  if (!supportedTokenPrograms.has(owner) || bytes.length < 82 || bytes[45] !== 1 || bytes[44] > 18) throw new Error('That address is not an initialized SPL token mint.')
  return bytes[44]
}

export async function createOnchainBattle({ wallet, signAndSendTransaction, tokenMint, stakeLamports, durationSeconds }) {
  const id = randomBattleId()
  const { programId, config, holderConfig, battle, vault } = deriveAccounts(id)
  const holderQuote = await getHolderFeeQuote(wallet.address)
  const data = concat(await discriminator('create_battle'), id, new PublicKey(tokenMint).toBytes(), u64(stakeLamports), u32(durationSeconds))
  const instruction = new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: holderConfig, isSigner: false, isWritable: false },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...holderQuote.accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
  })
  const signature = await send({ wallet, signAndSendTransaction, instruction })
  return { signature, battleAddress: battle.toBase58(), vaultAddress: vault.toBase58(), battleId: hexFromBytes(id), feeBps: holderQuote.feeBps }
}

export async function initializeHolderFeeConfig({ wallet, signAndSendTransaction }) {
  const { programId, config, holderConfig } = deriveAccounts(new Uint8Array(16))
  const instruction = new TransactionInstruction({
    programId,
    data: await discriminator('initialize_holder_config'),
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: holderConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })
  return send({ wallet, signAndSendTransaction, instruction })
}

export async function setHolderFeeConfig({ wallet, signAndSendTransaction, holderMint, tierMinimums, feeBps }) {
  if (tierMinimums.length !== 4 || feeBps.length !== 5) throw new Error('The holder fee configuration is incomplete.')
  const { programId, config, holderConfig } = deriveAccounts(new Uint8Array(16))
  const data = concat(
    await discriminator('set_holder_config'),
    new PublicKey(holderMint).toBytes(),
    ...tierMinimums.map(u64),
    ...feeBps.map(u16),
  )
  const instruction = new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: holderConfig, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(holderMint), isSigner: false, isWritable: false },
    ],
  })
  return send({ wallet, signAndSendTransaction, instruction })
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

export async function cancelOnchainBattle({ wallet, signAndSendTransaction, battleIdHex }) {
  const id = bytesFromHex(battleIdHex)
  const { programId, battle, vault } = deriveAccounts(id)
  const instruction = new TransactionInstruction({
    programId,
    data: await discriminator('cancel_waiting'),
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: true },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
    ],
  })
  const signature = await send({ wallet, signAndSendTransaction, instruction })
  return { signature, battleAddress: battle.toBase58(), vaultAddress: vault.toBase58(), battleId: hexFromBytes(id) }
}

export async function refundExpiredOnchainBattle({ wallet, signAndSendTransaction, battleIdHex, creatorAddress, opponentAddress }) {
  const id = bytesFromHex(battleIdHex)
  const { programId, battle, vault } = deriveAccounts(id)
  const instruction = new TransactionInstruction({
    programId,
    data: await discriminator('refund_expired'),
    keys: [
      { pubkey: new PublicKey(wallet.address), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(creatorAddress), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(opponentAddress), isSigner: false, isWritable: true },
      { pubkey: battle, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
    ],
  })
  const signature = await send({ wallet, signAndSendTransaction, instruction })
  return { signature, battleAddress: battle.toBase58(), vaultAddress: vault.toBase58(), battleId: hexFromBytes(id) }
}

export const isOnchainEscrowEnabled = () => Boolean(PROGRAM_ID)
