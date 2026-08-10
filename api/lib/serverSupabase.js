import { createClient } from '@supabase/supabase-js'

export function createServerSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing server Supabase environment variables.')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function assertCronRequest(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    const error = new Error('Unauthorized cron request.')
    error.status = 401
    throw error
  }
}
