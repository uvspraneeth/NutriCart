import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const options = { auth: { autoRefreshToken: false, persistSession: false } }

// Null when env vars are missing so API routes can degrade gracefully instead of crashing at import time.
export const supabaseServer = url && publicKey ? createClient(url, publicKey, options) : null

// Server-only writer used to cache products found externally. Optional: without it, caching is skipped.
export const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey, options) : null
