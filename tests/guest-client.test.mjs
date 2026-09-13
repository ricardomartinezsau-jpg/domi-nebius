import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webcrypto } from 'node:crypto'
import { loader } from './load-ts.mjs'

test('a lost response and module reload retain the same durable idempotency key', async () => {
  const entries = new Map()
  const keys = []
  let attempts = 0
  const globals = { crypto: webcrypto, TextEncoder, Uint8Array,
    localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) },
    fetch: async (url, options) => {
      if (url === '/api/guest') return Response.json({ ready: true })
      keys.push(options.headers['Idempotency-Key']); attempts++
      if (attempts === 1) throw new Error('response lost')
      return Response.json({ runId: 'same-run' }, { status: 202 })
    },
  }
  const input = { contextArea: 'trabajo', blocker: 'synthetic' }
  await assert.rejects(loader({}, globals)('lib/guest-client.ts').createResearch(input))
  const response = await loader({}, globals)('lib/guest-client.ts').createResearch(input)
  assert.equal(response.status, 202)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
})

test('storage failure prevents paid POST; resume never bootstraps another identity', async () => {
  const calls = []
  const api = loader({}, { crypto: webcrypto, TextEncoder, Uint8Array,
    localStorage: { getItem() { throw new Error('storage disabled') } },
    fetch: async url => { calls.push(url); return Response.json({}, { status: 404 }) },
  })('lib/guest-client.ts')
  await assert.rejects(api.createResearch({ taskTitle: 'synthetic', blocker: 'synthetic' }))
  assert.equal(calls.length, 0)
  await api.resumeResearch('known-run')
  assert.deepEqual(calls, ['/api/research'])
})
