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
  return result
}

async function postOnchainEscrowAction({ getAccessToken, walletAddress, body }) {
  const accessToken = await getPrivyAccessToken(getAccessToken)
  for (const delay of [0, 1_000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const response = await fetch('/api/onchain-battles', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, walletAddress }),
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok) return mapBattle(result.battle)
    const isConfirmationLag = response.status === 400 && result.error === 'The transaction was not confirmed by the escrow program.'
    if (!isConfirmationLag || delay) throw new Error(result.error || 'Unable to synchronize the on-chain battle.')
  }
}

export function syncOnchainBattle(input) {
  return postOnchainEscrowAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: input.body,
  })
}

export function syncOnchainEscrowAction(input) {
  return postOnchainEscrowAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: input.body,
  })
}

export async function recoverOnchainBattles({ getAccessToken, walletAddress }) {
  const accessToken = await getPrivyAccessToken(getAccessToken)
  const response = await fetch('/api/onchain-battles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'recover', walletAddress }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to recover on-chain battles.')
  return (result.battles ?? []).map(mapBattle)
}

export function createBattle(input) {
  return postBattleAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: {
      action: 'prepare_create',
      token: input.token,
      stakeSol: input.stakeSol,
      durationSeconds: input.durationSeconds,
    },
  })
}

export function joinBattle(input) {
  return postBattleAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: {
      action: 'prepare_join',
      battleId: input.battleId,
    },
  })
}

export async function confirmBattleDeposit(input) {
  const result = await postBattleAction({
    getAccessToken: input.getAccessToken,
    walletAddress: input.walletAddress,
    body: {
      action: input.action === 'join' ? 'confirm_join' : 'confirm_create',
      depositIntentId: input.depositIntentId,
      depositSignature: input.depositSignature,
      token: input.token,
    },
  })
  return mapBattle(result.battle)
}
