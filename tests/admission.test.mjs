import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueGuest, readGuest, guestCookie, mutationBody, ipBucket, setGuestCookie } from '../lib/guest.ts'
import { assertAdmission, reserveLimits, LIMITS } from '../lib/admission.ts'

process.env.BETTER_AUTH_SECRET = 'test-only-secret-at-least-thirty-two-characters'
process.env.BETTER_AUTH_URL = 'https://domi.test'
const req = (body = '{}', headers = {}) => new Request('https://domi.test/api/triage', {
  method: 'POST', headers: { origin: 'https://domi.test', 'content-type': 'application/json', ...headers }, body,
})

test('guest cookie is signed, expires, and cannot be forged', () => {
  const token = issueGuest(1000)
  const request = req('{}', { cookie: `${guestCookie()}=${token}` })
  assert.ok(readGuest(request, 1001))
  assert.equal(readGuest(request, 1000 + 30 * 86400_000), null)
  assert.equal(readGuest(req('{}', { cookie: `${guestCookie()}=${token}x` }), 1001), null)
})

test('body limit counts UTF-8 bytes and rejects cross-origin / non-JSON', async () => {
  await assert.rejects(mutationBody(req(JSON.stringify('éé'), { 'content-length': '0' }), 5), { status: 413 })
  await assert.rejects(mutationBody(req('{}', { origin: 'https://evil.test' }), 50), { status: 403 })
  await assert.rejects(mutationBody(req('{}', { 'content-type': 'text/plain' }), 50), { status: 415 })
  await assert.rejects(mutationBody(req('{'), 50), { status: 400 })
  assert.deepEqual(await mutationBody(req(), 50), {})
})

test('production cookies are host-only, HttpOnly and Secure; insecure configured origins fail closed', async () => {
  const previousMode = process.env.NODE_ENV
  const previousOrigin = process.env.BETTER_AUTH_URL
  try {
    process.env.NODE_ENV = 'production'
    const header = setGuestCookie(issueGuest())
    assert.match(header, /^__Host-domi-guest=/)
    assert.match(header, /; HttpOnly; SameSite=Lax; Secure$/)
    assert.doesNotMatch(header, /Domain=/i)
    process.env.BETTER_AUTH_URL = 'http://domi.test'
    await assert.rejects(mutationBody(req(), 100), { code: 'ORIGIN_CONFIGURATION' })
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousMode
    process.env.BETTER_AUTH_URL = previousOrigin
  }
})

test('admission is closed unless explicitly enabled', () => {
  delete process.env.DOMI_ADMISSION_ENABLED
  assert.throws(assertAdmission, { status: 503 })
  process.env.DOMI_ADMISSION_ENABLED = 'TRUE'
  assert.throws(assertAdmission, { status: 503 })
  process.env.DOMI_ADMISSION_ENABLED = 'true'
  assert.doesNotThrow(assertAdmission)
})

test('forged forwarding headers and rotating cookies cannot select a new IP bucket', () => {
  assert.equal(ipBucket(req('{}', { 'x-forwarded-for': '1.2.3.4' })), ipBucket(req('{}', { 'x-forwarded-for': '5.6.7.8', 'x-real-ip': '9.8.7.6' })))
})

test('quota refusal is explicit and reservations use conditional atomic SQL', async () => {
  const calls = []
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] } } }
  await assert.rejects(reserveLimits(client, [{ key: 'global:nebius', limit: LIMITS.nebius, units: 2, seconds: 86400 }]), { status: 429 })
  assert.match(calls[0].sql, /ON CONFLICT/)
  assert.match(calls[0].sql, /used \+ EXCLUDED.used <=/)
  assert.equal(calls[0].params[2], 2)
})
