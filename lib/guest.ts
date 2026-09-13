import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { PolicyError } from './operations.ts'

const AGE = 30 * 86400
export const guestCookie = () => process.env.NODE_ENV === 'production' ? '__Host-domi-guest' : 'domi-guest'
function sign(value: string, purpose: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new PolicyError(503, 'GUEST_CONFIGURATION')
  return createHmac('sha256', secret).update(`domi:${purpose}:v1:${value}`).digest('base64url')
}
export function issueGuest(now = Date.now()) {
  const payload = `${randomUUID()}.${Math.floor(now / 1000) + AGE}`
  return `${payload}.${sign(payload, 'guest-cookie')}`
}
export function readGuest(request: Request, now = Date.now()): string | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${guestCookie()}=`))
  if (matches.length !== 1) return null
  const value = matches[0].slice(guestCookie().length + 1)
  const match = /^([a-f0-9-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match || Number(match[2]) <= Math.floor(now / 1000) || Number(match[2]) > Math.floor(now / 1000) + AGE) return null
  const expected = sign(`${match[1]}.${match[2]}`, 'guest-cookie')
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))) return null
  return sign(match[1], 'guest-owner')
}
export function requireGuest(request: Request, hidden = false) {
  const owner = readGuest(request)
  if (!owner) throw new PolicyError(hidden ? 404 : 428, hidden ? 'NOT_FOUND' : 'GUEST_REQUIRED')
  return owner
}
export function setGuestCookie(value: string) {
  return `${guestCookie()}=${value}; Path=/; Max-Age=${AGE}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}
/** No verified proxy contract exists here yet. Ignore ALL forwarded IP headers. */
export function ipBucket(_request: Request) { return 'unverified-proxy-shared' }

export async function mutationBody(request: Request, maxBytes: number): Promise<unknown> {
  let origin: string
  try { origin = new URL(process.env.BETTER_AUTH_URL ?? '').origin } catch { throw new PolicyError(503, 'ORIGIN_CONFIGURATION') }
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new PolicyError(503, 'ORIGIN_CONFIGURATION')
  if (request.headers.get('origin') !== origin) throw new PolicyError(403, 'ORIGIN_REJECTED')
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new PolicyError(415, 'JSON_REQUIRED')
  if (Number(request.headers.get('content-length')) > maxBytes) throw new PolicyError(413, 'BODY_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new PolicyError(400, 'INVALID_JSON')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new PolicyError(413, 'BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new PolicyError(400, 'INVALID_JSON') }
}
