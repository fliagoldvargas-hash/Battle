const TOKEN_PROGRAM_IDS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdYdY5rTyEFD9R29qn6R7b2hv3ih3dYY8kLAs',
]

export const DEFAULT_FEE_SCHEDULE = Object.freeze({
  holderMint: null,
  holderMintDecimals: 0,
  tierMinimums: ['1000', '10000', '100000', '1000000'],
  feeBps: [100, 75, 50, 25, 10],
})

const rpcUrl = () => process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function rpcError(message, status = 503) {
  return Object.assign(new Error(message), { status })
}

async function solanaRpc(method, params) {
  let response
  try {
    response = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw rpcError('The Solana RPC is unavailable. Please try again shortly.')
  }
  if (!response.ok) throw rpcError('The Solana RPC is unavailable. Please try again shortly.')
  let payload
  try {
    payload = await response.json()
  } catch {
    throw rpcError('The Solana RPC returned an invalid response.')
  }
  if (payload.error) throw rpcError('The Solana RPC could not process this request.')
  return payload.result
}

function number(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw Object.assign(new Error('The fee schedule contains an invalid basis-points value.'), { status: 400 })
  }
  return parsed
}

function scheduleFromRow(row) {
  if (!row) return DEFAULT_FEE_SCHEDULE
  return {
    holderMint: row.holder_mint || null,
    holderMintDecimals: Number(row.holder_mint_decimals || 0),
    tierMinimums: [row.tier_one_minimum, row.tier_two_minimum, row.tier_three_minimum, row.tier_four_minimum].map(String),
    feeBps: [row.no_holder_fee_bps, row.tier_one_fee_bps, row.tier_two_fee_bps, row.tier_three_fee_bps, row.tier_four_fee_bps].map(number),
  }
}

export async function getFeeSchedule(supabase) {
  const { data, error } = await supabase.from('protocol_fee_schedules').select('*').eq('singleton', true).maybeSingle()
  if (error) throw error
  return scheduleFromRow(data)
}

export function feeForBalance(schedule, balance) {
  if (!schedule.holderMint) return schedule.feeBps[0]
  const thresholds = schedule.tierMinimums.map((value) => BigInt(value))
  const amount = BigInt(balance)
  if (amount >= thresholds[3]) return schedule.feeBps[4]
  if (amount >= thresholds[2]) return schedule.feeBps[3]
  if (amount >= thresholds[1]) return schedule.feeBps[2]
  if (amount >= thresholds[0]) return schedule.feeBps[1]
  return schedule.feeBps[0]
}

export async function holderBalance(walletAddress, mintAddress) {
  if (!mintAddress) return 0n
  if (!SOLANA_ADDRESS_PATTERN.test(walletAddress) || !SOLANA_ADDRESS_PATTERN.test(mintAddress)) {
    throw rpcError('The wallet or token address is invalid.', 400)
  }
  const accounts = (await solanaRpc('getTokenAccountsByOwner', [
    walletAddress,
    { mint: mintAddress },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]))?.value ?? []
  return accounts
    .reduce((total, account) => total + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n)
}

export async function quoteFeeForWallet(supabase, walletAddress) {
  const schedule = await getFeeSchedule(supabase)
  const balance = schedule.holderMint ? await holderBalance(walletAddress, schedule.holderMint) : 0n
  return { ...schedule, holderBalance: balance.toString(), feeBps: feeForBalance(schedule, balance) }
}

export async function validateFeeSchedule(input) {
  const holderMint = String(input?.holderMint || '').trim()
  let mint = null
  let holderMintDecimals = 0
  if (holderMint) {
    if (!SOLANA_ADDRESS_PATTERN.test(holderMint)) {
      throw Object.assign(new Error('The supplied CA is not a valid Solana mint address.'), { status: 400 })
    }
    const account = (await solanaRpc('getAccountInfo', [holderMint, { encoding: 'base64', commitment: 'confirmed' }]))?.value
    const data = typeof account?.data?.[0] === 'string' ? Buffer.from(account.data[0], 'base64') : null
    if (!account || !TOKEN_PROGRAM_IDS.includes(account.owner) || !data || data.length < 82 || data[45] !== 1) {
      throw Object.assign(new Error('The supplied CA is not an initialized SPL or Token-2022 mint.'), { status: 400 })
    }
    mint = holderMint
    holderMintDecimals = data[44]
  }
  const tierMinimums = input?.tierMinimums?.map((value) => BigInt(value))
  const feeBps = input?.feeBps?.map(number)
  if (!tierMinimums || tierMinimums.length !== 4 || tierMinimums.some((value) => value <= 0n)
    || !feeBps || feeBps.length !== 5) {
    throw Object.assign(new Error('Provide four positive token thresholds and five fee rates.'), { status: 400 })
  }
  if (tierMinimums.some((value, index) => index > 0 && value <= tierMinimums[index - 1])
    || feeBps.some((value, index) => index > 0 && value > feeBps[index - 1])) {
    throw Object.assign(new Error('Holder tiers must ascend and fees must not increase by tier.'), { status: 400 })
  }
  return { holderMint: mint || null, holderMintDecimals, tierMinimums: tierMinimums.map(String), feeBps }
}

export async function saveFeeSchedule(supabase, schedule, adminWallet) {
  const [tierOne, tierTwo, tierThree, tierFour] = schedule.tierMinimums
  const [noHolder, tierOneFee, tierTwoFee, tierThreeFee, tierFourFee] = schedule.feeBps
  const { data, error } = await supabase.from('protocol_fee_schedules').upsert({
    singleton: true,
    holder_mint: schedule.holderMint,
    holder_mint_decimals: schedule.holderMintDecimals,
    tier_one_minimum: tierOne,
    tier_two_minimum: tierTwo,
    tier_three_minimum: tierThree,
    tier_four_minimum: tierFour,
    no_holder_fee_bps: noHolder,
    tier_one_fee_bps: tierOneFee,
    tier_two_fee_bps: tierTwoFee,
    tier_three_fee_bps: tierThreeFee,
    tier_four_fee_bps: tierFourFee,
    updated_by_wallet: adminWallet,
    updated_at: new Date().toISOString(),
  }).select('*').single()
  if (error) throw error
  return scheduleFromRow(data)
}
