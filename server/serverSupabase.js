import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const githubActionsJwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
const githubActionsIssuer = 'https://token.actions.githubusercontent.com'
const githubActionsAudience = 'vantaagents-battle-cron'
const githubRepository = 'fliagoldvargas-hash/Battle'
const githubWorkflowRefs = new Set([
  `${githubRepository}/.github/workflows/process-battles.yml@refs/heads/main`,
  `${githubRepository}/.github/workflows/process-devnet-oracle.yml@refs/heads/main`,
])

export function createServerSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing server Supabase environment variables.')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function assertCronRequest(request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.authorization
  if (secret && authorization === `Bearer ${secret}`) return

  if (authorization?.startsWith('Bearer ')) {
    try {
      const token = authorization.slice('Bearer '.length)
      const { payload } = await jwtVerify(token, githubActionsJwks, {
        issuer: githubActionsIssuer,
        audience: githubActionsAudience,
      })
      const validWorkflow = payload.repository === githubRepository
        && payload.ref === 'refs/heads/main'
        && githubWorkflowRefs.has(payload.workflow_ref)
        && (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch')
      if (validWorkflow) return
    } catch {
      // Continue to the single unauthorized response below. Do not leak token
      // validation details to callers.
    }
  }

  const error = new Error('Unauthorized cron request.')
  error.status = 401
  throw error
}
