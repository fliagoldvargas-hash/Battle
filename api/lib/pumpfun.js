const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const PUMPFUN_COIN_URL = 'https://frontend-api-v3.pump.fun/coins-v2/'

function invalidToken(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

export function normalizeMint(mint) {
  const normalized = typeof mint === 'string' ? mint.trim() : ''
  if (!SOLANA_MINT_PATTERN.test(normalized)) {
    throw invalidToken('Enter a valid Solana contract address.')
  }
  return normalized
}

export async function getPumpFunToken(mint) {
  const normalizedMint = normalizeMint(mint)
  let upstreamResponse

  try {
    upstreamResponse = await fetch(`${PUMPFUN_COIN_URL}${encodeURIComponent(normalizedMint)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Battle token lookup' },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    const error = new Error('Pump.fun is temporarily unavailable. Please try again.')
    error.status = 503
    throw error
  }

  if (upstreamResponse.status === 404) {
    throw invalidToken('This contract address is not a token on Pump.fun.')
  }
  if (!upstreamResponse.ok) {
    const error = new Error('Pump.fun could not verify this token right now.')
    error.status = 503
    throw error
  }

  const coin = await upstreamResponse.json()
  if (coin?.mint !== normalizedMint || !coin?.symbol) {
    throw invalidToken('This contract address is not a token on Pump.fun.')
  }

  const marketCap = Number(coin.usd_market_cap ?? coin.market_cap)
  const totalSupply = Number(coin.total_supply ?? coin.total_supply_str)
  const priceUsd = Number.isFinite(marketCap) && Number.isFinite(totalSupply) && totalSupply > 0
    ? marketCap / totalSupply
    : null
  return {
    mint: coin.mint,
    name: typeof coin.name === 'string' ? coin.name : coin.symbol,
    symbol: coin.symbol.slice(0, 32),
    marketCap: Number.isFinite(marketCap) && marketCap >= 0 ? marketCap : null,
    priceUsd: Number.isFinite(priceUsd) && priceUsd >= 0 ? priceUsd : null,
    totalSupply: Number.isFinite(totalSupply) && totalSupply >= 0 ? totalSupply : null,
    imageUrl: typeof coin.image_uri === 'string' ? coin.image_uri : null,
    complete: Boolean(coin.complete),
  }
}
