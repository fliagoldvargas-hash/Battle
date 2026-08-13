import { Connection, PublicKey } from '@solana/web3.js'

const send = (response, status, body) => response.status(status).json(body)
const network = () => process.env.BATTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
const rpcUrl = () => process.env.SOLANA_RPC_URL || (network() === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com')

function pubkeyAt(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58()
}

function holderSchedule(data) {
  if (data.length < 84) throw new Error('The holder fee account has an unexpected layout.')
  const u64At = (offset) => data.readBigUInt64LE(offset).toString()
  const u16At = (offset) => data.readUInt16LE(offset)
  return {
    initialized: true,
    holderMint: pubkeyAt(data, 8),
    decimals: data[40],
    tierMinimums: [u64At(41), u64At(49), u64At(57), u64At(65)],
    feeBps: [u16At(73), u16At(75), u16At(77), u16At(79), u16At(81)],
  }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })

  try {
    const programIdValue = process.env.ESCROW_PROGRAM_ID
    if (!programIdValue) return send(response, 200, { network: network(), configured: false, reason: 'program_not_configured' })
    const programId = new PublicKey(programIdValue)
    const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
    const [holderConfig] = PublicKey.findProgramAddressSync([Buffer.from('holder-config')], programId)
    const connection = new Connection(rpcUrl(), 'confirmed')
    const [configAccount, holderAccount] = await Promise.all([
      connection.getAccountInfo(config, 'confirmed'),
      connection.getAccountInfo(holderConfig, 'confirmed'),
    ])

    const base = {
      network: network(), programId: programId.toBase58(), configAddress: config.toBase58(), holderConfigAddress: holderConfig.toBase58(),
    }
    if (!configAccount) return send(response, 200, { ...base, configured: false, reason: 'config_not_initialized' })
    if (!configAccount.owner.equals(programId) || configAccount.data.length < 106) {
      return send(response, 503, { ...base, configured: false, error: 'The on-chain escrow configuration could not be verified.' })
    }
    if (holderAccount && (!holderAccount.owner.equals(programId) || holderAccount.data.length < 84)) {
      return send(response, 503, { ...base, configured: false, error: 'The on-chain holder fee configuration could not be verified.' })
    }
    return send(response, 200, {
      ...base,
      configured: true,
      adminWallet: pubkeyAt(configAccount.data, 8),
      feeTreasury: pubkeyAt(configAccount.data, 40),
      settlementAuthority: pubkeyAt(configAccount.data, 72),
      holderConfig: holderAccount ? holderSchedule(holderAccount.data) : null,
    })
  } catch (error) {
    console.error('On-chain status lookup failed', error instanceof Error ? error.message : error)
    return send(response, 503, { network: network(), configured: false, error: 'The on-chain escrow status is temporarily unavailable.' })
  }
}
