import 'server-only'
import { createHash } from 'node:crypto'
import dns, { type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { supabaseAdmin } from '@/lib/supabase/server'

// Staff paste arbitrary image links, and the server fetches them, so guard against SSRF:
// only public addresses, checked when the socket connects (defeats DNS rebinding), on every redirect hop.
const BUCKET = 'product-images'
const MAX_BYTES = 2 * 1024 * 1024 // matches the bucket's file_size_limit
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3

const blocked = new net.BlockList()
for (const [net4, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net4, prefix, 'ipv4')
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(net6, prefix, 'ipv6')

export function isBlockedAddress(address: string) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped, 'ipv4')
  const family = net.isIP(address)
  return family === 0 || blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

class ImageError extends Error {}

const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 4)
    if (!addresses.length || addresses.some(a => isBlockedAddress(a.address))) return callback(new ImageError('blocked address'), '', 4)
    if ((options as dns.LookupAllOptions).all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

function download(url: URL, redirects = 0, deadline = Date.now() + TIMEOUT_MS): Promise<Buffer> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new ImageError('only http(s) links are allowed'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // IP literals skip DNS lookup entirely, so check them here.
  if (net.isIP(host) && isBlockedAddress(host)) return Promise.reject(new ImageError('blocked address'))
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, { lookup: guardedLookup, timeout: Math.max(1, deadline - Date.now()), headers: { 'User-Agent': 'NutriCart/0.1 (product image import)', Accept: 'image/*' } }, response => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirects >= MAX_REDIRECTS) return reject(new ImageError('too many redirects'))
        return download(new URL(response.headers.location, url), redirects + 1, deadline).then(resolve, reject)
      }
      if (status !== 200) { response.resume(); return reject(new ImageError(`server answered ${status}`)) }
      if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) { response.destroy(); return reject(new ImageError('image is larger than 2 MB')) }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BYTES) { response.destroy(); reject(new ImageError('image is larger than 2 MB')) } else chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new ImageError('timed out')))
    request.on('error', error => reject(error instanceof ImageError ? error : new ImageError(error.message.includes('blocked address') ? 'blocked address' : 'couldn’t reach the site')))
  })
}

// Trust the file's own signature, not the server's Content-Type or the link's extension.
const SIGNATURES: Array<{ type: string; ext: string; test: (b: Buffer) => boolean }> = [
  { type: 'image/jpeg', ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', ext: 'webp', test: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { type: 'image/gif', ext: 'gif', test: b => /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)) },
  { type: 'image/avif', ext: 'avif', test: b => b.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(b.toString('latin1', 8, 12)) },
]
export const imageType = (bytes: Buffer) => SIGNATURES.find(s => bytes.length > 12 && s.test(bytes)) ?? null

const publicPrefix = () => supabaseAdmin!.storage.from(BUCKET).getPublicUrl('').data.publicUrl

/** True when the link already points at our own bucket (no need to download it again). */
export function isRehosted(url: string) {
  return Boolean(supabaseAdmin) && url.startsWith(publicPrefix())
}

export type RehostResult = { ok: true; url: string } | { ok: false; reason: string }

/** Downloads an image link, checks it really is an image, and stores a copy in Storage so the product never depends on the source site. */
export async function rehostImage(link: string, barcode: string): Promise<RehostResult> {
  try {
    let url: URL
    try { url = new URL(link) } catch { return { ok: false, reason: 'not a valid link' } }
    const bytes = await download(url)
    const type = imageType(bytes)
    if (!type) return { ok: false, reason: 'the link isn’t a JPEG, PNG, WebP, GIF or AVIF image' }
    // Content-addressed path: a changed image gets a new URL, so long browser caching is safe.
    const path = `${barcode}/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${type.ext}`
    const { error } = await supabaseAdmin!.storage.from(BUCKET).upload(path, bytes, { contentType: type.type, upsert: true, cacheControl: '31536000' })
    if (error) { console.error('[images] Upload failed:', error.message); return { ok: false, reason: 'storage upload failed' } }
    return { ok: true, url: supabaseAdmin!.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
  } catch (error) {
    return { ok: false, reason: error instanceof ImageError ? error.message : 'download failed' }
  }
}
