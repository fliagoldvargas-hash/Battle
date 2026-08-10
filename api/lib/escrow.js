const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/

function configurationError(message) {
  const error = new Error(message)
  error.status = 503
  error.code = 'ESCROW_NOT_CONFIGURED'
  return error
}

export function escrowConfiguration() {
  const treasury = process.env.ESCROW_TREASURY_ADDRESS
  if (!treasury || !SOLANA_ADDRESS_PATTERN.test(treasury)) {
    throw configurationError('Escrow is not configured: set ESCROW_TREASURY_ADDRESS to a Solana treasury address.')
  }
  return {
    treasury,
    programId: process.env.ESCROW_PROGRAM_ID || null,
    required: process.env.ESCROW_REQUIRED === 'true',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  }
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `battle-${Date.now()}`, method, params }),
  })
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (payload.error) throw new Error(payload.error.message || 'Solana RPC request failed.')
  return payload.result
}

function parsedInstructions(transaction) {
  const instructions = transaction?.transaction?.message?.instructions ?? []
  const inner = (transaction?.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? [])
  return [...instructions, ...inner]
}

export async function verifyStakeTransfer({ signature, walletAddress, expectedLamports }) {
  const config = escrowConfiguration()
  if (!SIGNATURE_PATTERN.test(signature || '')) {
    const error = new Error('Invalid Solana transaction signature.')
    error.status = 400
    throw error
  }
  if (!SOLANA_ADDRESS_PATTERN.test(walletAddress || '')) {
    const error = new Error('Invalid Solana wallet address.')
    error.status = 400
    throw error
  }
  if (!Number.isSafeInteger(Number(expectedLamports)) || Number(expectedLamports) <= 0) {
    const error = new Error('Invalid escrow amount.')
    error.status = 400
    throw error
  }

  const transaction = await rpcCall(config.rpcUrl, 'getTransaction', [signature, {
    encoding: 'jsonParsed',
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  }])
  if (!transaction || transaction.meta?.err) {
    const error = new Error('The Solana deposit is not finalized or failed.')
    error.status = 400
    throw error
  }

  const transfer = parsedInstructions(transaction).find((instruction) => (
    instruction?.program === 'system'
    && instruction?.parsed?.type === 'transfer'
    && instruction.parsed.info?.destination === config.treasury
    && instruction.parsed.info?.source === walletAddress
    && Number(instruction.parsed.info?.lamports) >= Number(expectedLamports)
  ))
  if (!transfer) {
    const error = new Error('The finalized transaction does not transfer the required stake to the escrow treasury.')
    error.status = 400
    throw error
  }

  return {
    signature,
    treasury: config.treasury,
    programId: config.programId,
    lamports: Number(transfer.parsed.info.lamports),
    slot: transaction.slot,
    blockTime: transaction.blockTime,
  }
}

export async function recordDeposit({ supabase, battleId, walletAddress, role, signature, expectedLamports }) {
  const verified = await verifyStakeTransfer({ signature, walletAddress, expectedLamports })
  const { data: existing, error: lookupError } = await supabase
    .from('battles')
    .select('id')
    .or(`creator_deposit_signature.eq.${verified.signature},opponent_deposit_signature.eq.${verified.signature}`)
    .neq('id', battleId)
    .limit(1)
  if (lookupError) throw lookupError
  if (existing?.length) {
    const error = new Error('This Solana deposit has already been used for another battle.')
    error.status = 409
    throw error
  }
  const signatureColumn = role === 'creator' ? 'creator_deposit_signature' : 'opponent_deposit_signature'
  const { data, error } = await supabase
    .from('battles')
    .update({
      [signatureColumn]: verified.signature,
      escrow_account: verified.treasury,
      escrow_program_id: verified.programId,
      escrow_state: role === 'creator' ? 'awaiting_deposits' : 'funded',
      escrow_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', battleId)
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') {
      const replayError = new Error('This Solana deposit has already been used for another battle.')
      replayError.status = 409
      throw replayError
    }
    if (error.code === '42703') {
      const schemaError = configurationError('Escrow metadata is not installed in Supabase. Apply supabase/migrations/20260810010000_escrow_metadata.sql first.')
      schemaError.code = 'ESCROW_SCHEMA_NOT_APPLIED'
      throw schemaError
    }
    throw error
  }
  return { battle: data, verified }
}
