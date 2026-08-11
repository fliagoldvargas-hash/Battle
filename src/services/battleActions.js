import { mapBattle } from './battles'

async function postBattleAction({ getAccessToken, walletAddress, body }) {
  let accessToken = await getAccessToken()
  if (!accessToken) {
    await new Promise(resolve => setTimeout(resolve, 300))
    accessToken = await getAccessToken()
  }
  if (!accessToken) throw new Error('Your Privy session expired. Please reconnect your wallet.')

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
  let accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Your Privy session expired. Please reconnect your wallet.')
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
