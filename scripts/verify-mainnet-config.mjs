import { Connection, PublicKey } from '@solana/web3.js'

const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const programId = new PublicKey(process.env.ESCROW_PROGRAM_ID || 'CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m')
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed')
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
const [holderConfig] = PublicKey.findProgramAddressSync([Buffer.from('holder-config')], programId)

if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error('SOLANA_RPC_URL is not a Mainnet endpoint.')
const [configAccount, holderAccount] = await Promise.all([
  connection.getAccountInfo(config, 'confirmed'),
  connection.getAccountInfo(holderConfig, 'confirmed'),
])
if (!configAccount?.owner.equals(programId)) throw new Error('Mainnet config PDA has not been initialized by this program.')
if (!holderAccount?.owner.equals(programId)) throw new Error('Mainnet holder fee PDA has not been initialized by this program.')
if (configAccount.data.length < 106 || holderAccount.data.length < 84) throw new Error('Mainnet configuration account has an unexpected layout.')

const pubkeyAt = (bytes, offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58()
console.log(JSON.stringify({
  verified: true,
  programId: programId.toBase58(),
  config: config.toBase58(),
  holderConfig: holderConfig.toBase58(),
  admin: pubkeyAt(configAccount.data, 8),
  feeTreasury: pubkeyAt(configAccount.data, 40),
  settlementAuthority: pubkeyAt(configAccount.data, 72),
  holderMint: pubkeyAt(holderAccount.data, 8),
  defaultFeeBps: new DataView(holderAccount.data.buffer, holderAccount.data.byteOffset + 73, 2).getUint16(0, true),
}))
