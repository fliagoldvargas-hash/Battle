import { mapBattle } from './battles'

async function getPrivyAccessToken(getAccessToken) {
  // Privy may finish updating React state a moment after SIWS succeeds. Wait
  // briefly for its access token instead of reporting a false expired-session
  // error immediately after a successful wallet connection.
  for (const delay of [0, 300, 700]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const accessToken = await getAccessToken()
    if (accessToken) return accessToken
  }

  throw new Error('Your Privy session is still initializing. Please wait a moment and try again.')
}

async function postBattleAction({ getAccessToken, walletAddress, body }) {
  const accessToken = await getPrivyAccessToken(getAccessToken)

  const response = await fetch('/api/battles', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, walletAddress }),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to update the battle.')
  return mapBattle(result.battle)
}

async function postDevnetEscrowAction({ getAccessToken, walletAddress, body }) {
  const accessToken = await getPrivyAccessToken(getAccessToken)
  const response = await fetch('/api/devnet-battles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, walletAddress }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to synchronize the Devnet battle.')
  return mapBattle(result.battle)
}

export function syncDevnetBattle(input) {
  return postDevnetEscrowAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: input.body,
  })
}

export function syncDevnetEscrowAction(input) {
  return postDevnetEscrowAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: input.body,
  })
}

export async function recoverDevnetBattles({ getAccessToken, walletAddress }) {
  const accessToken = await getPrivyAccessToken(getAccessToken)
  const response = await fetch('/api/devnet-battles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'recover', walletAddress }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to recover Devnet battles.')
  return (result.battles ?? []).map(mapBattle)
}

export function createBattle(input) {
  return postBattleAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: {
      action: 'create',
      token: input.token,
      stakeSol: input.stakeSol,
      durationSeconds: input.durationSeconds,
      depositSignature: input.depositSignature,
    },
  })
}

export function joinBattle(input) {
  return postBattleAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: {
      action: 'join',
      battleId: input.battleId,
      token: input.token,
      depositSignature: input.depositSignature,
    },
  })
}
