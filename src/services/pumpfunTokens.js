export async function lookupPumpFunToken(mint) {
  const response = await fetch(`/api/tokens?mint=${encodeURIComponent(mint.trim())}`)
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to look up the token.')
  return result.token
}
