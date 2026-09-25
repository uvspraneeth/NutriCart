import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/server'

// Shared-PIN staff access. The cookie is `<expiresAt>.<hmac>`; the HMAC key mixes in the PIN so changing
// ADMIN_PIN signs everyone out.
export const SESSION_COOKIE = 'nc_admin'
const SESSION_MS = 12 * 60 * 60 * 1000
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

const pin = process.env.ADMIN_PIN
const secret = process.env.ADMIN_SESSION_SECRET

/** Names of the server env vars the admin area still needs. Empty when it's ready. */
export function missingAdminConfig() {
  return [
    !pin && 'ADMIN_PIN',
    !secret && 'ADMIN_SESSION_SECRET',
    !supabaseAdmin && 'SUPABASE_SECRET_KEY',
  ].filter((name): name is string => Boolean(name))
}

const digest = (value: string) => createHash('sha256').update(value).digest()
const sign = (expiresAt: number) => createHmac('sha256', `${secret}:${pin}`).update(String(expiresAt)).digest('base64url')

function safeEqual(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}

// Per-instance only: good enough to slow down guessing on a single server, not a distributed limiter.
const attempts = new Map<string, { count: number; resetAt: number }>()

async function clientIp() {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
}

export type PinResult = { ok: true } | { ok: false; error: string }

export async function checkPin(input: string): Promise<PinResult> {
  if (missingAdminConfig().length) return { ok: false, error: 'Admin access isn’t configured on this server.' }
  const ip = await clientIp()
  const now = Date.now()
  const entry = attempts.get(ip)
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((entry.resetAt - now) / 60000)} min.` }
  }
  if (timingSafeEqual(digest(input), digest(pin!))) { attempts.delete(ip); return { ok: true } }
  const next = entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + LOCKOUT_MS }
  attempts.set(ip, next)
  return { ok: false, error: next.count >= MAX_ATTEMPTS ? 'Too many attempts. Try again in 5 min.' : 'Wrong PIN.' }
}

export async function createSession() {
  const expiresAt = Date.now() + SESSION_MS
  const store = await cookies()
  store.set(SESSION_COOKIE, `${expiresAt}.${sign(expiresAt)}`, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/admin', expires: new Date(expiresAt),
  })
}

export async function deleteSession() {
  const store = await cookies()
  store.delete({ name: SESSION_COOKIE, path: '/admin' })
}

export async function isStaff() {
  // Read cookies before anything else so admin pages are always rendered per request, never prerendered.
  const value = (await cookies()).get(SESSION_COOKIE)?.value
  if (missingAdminConfig().length) return false
  const [expires, mac] = value?.split('.') ?? []
  const expiresAt = Number(expires)
  return Boolean(mac) && Number.isFinite(expiresAt) && expiresAt > Date.now() && safeEqual(mac, sign(expiresAt))
}

/** Gate for every admin page and server action. Proxy only does an optimistic cookie-present check. */
export async function requireStaff() {
  if (!(await isStaff())) redirect('/admin/login')
}
