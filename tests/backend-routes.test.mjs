import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'
const runId = 'c2e9c623-8016-4b43-a4e3-9955b8c99fb2'
const post = (path, body, cookie) => new Request(`https://domi.test${path}`, { method: 'POST', headers: {
  origin: 'https://domi.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
}, body: JSON.stringify(body) })

test('research GET/resume without guest credentials both return 404 before DB/workflow', async () => {
  let calls = 0
  const load = loader({
    'lib/research.ts': { readResearch: async () => { calls++ } },
    'lib/research-lifecycle.ts': { createResearchRun: async () => { calls++ } },
    'lib/research-dispatch.ts': { dispatchResearch: async () => { calls++ } },
    'lib/db.ts': {},
  })
  const route = load('app/api/research/route.ts')
  assert.equal((await route.GET(new Request(`https://domi.test/api/research?runId=${runId}`))).status, 404)
  assert.equal((await route.POST(post('/api/research', { runId }))).status, 404)
  assert.equal(calls, 0)
})

test('creation with unavailable DB returns 503 without dispatching', async () => {
  let dispatched = 0
  let dbCalls = 0
  const load = loader({
    'lib/db.ts': { transaction: async () => { dbCalls++; throw new Error('synthetic DB unavailable') } },
    'lib/research-dispatch.ts': { dispatchResearch: async () => { dispatched++ } },
  })
  const guest = load('lib/guest.ts')
  const request = post('/api/research', { taskTitle: 'synthetic', blocker: 'synthetic' }, `${guest.guestCookie()}=${guest.issueGuest()}`)
  request.headers.set('idempotency-key', 'synthetic-key-123456')
  assert.equal((await load('app/api/research/route.ts').POST(request)).status, 503)
  assert.equal(dispatched, 0)
  assert.equal(dbCalls, 1)
})

test('triage rejects malformed, oversized and anonymous requests without generation', async () => {
  let generated = 0
  const load = loader({ 'lib/db.ts': {}, 'lib/nebius.ts': { generateStructured: async () => { generated++; throw new Error('must not be reached') } } })
  const route = load('app/api/triage/route.ts')
  assert.equal((await route.POST(post('/api/triage', { phase: 'quick', rawDump: 'synthetic' }))).status, 428)
  assert.equal((await route.POST(post('/api/triage', { phase: 'quick', rawDump: 'x'.repeat(70000) }))).status, 413)
  const malformed = post('/api/triage', {})
  malformed.headers.set('content-type', 'text/plain')
  assert.equal((await route.POST(malformed)).status, 415)
  assert.equal(generated, 0)
})

test('detail hook is bounded before quota reservation or generation', async () => {
  let generated = 0
  const load = loader({ 'lib/db.ts': { transaction: async () => { throw new Error('quota must not be reserved') } },
    'lib/nebius.ts': { generateStructured: async () => { generated++ } } })
  const guest = load('lib/guest.ts')
  const quick = { trayDispatch: { personalBienestar: [], profesionalProductiva: [], familiarDomestica: [], socialComunitaria: [] },
    momentumMode: { activationHook: 'x'.repeat(1001), cognitiveLoadLevel: 'baja', antiDopamineTraps: [], singleFocusShield: '' } }
  const response = await load('app/api/triage/route.ts').POST(post('/api/triage', { phase: 'detail', rawDump: 'synthetic', quick }, `${guest.guestCookie()}=${guest.issueGuest()}`))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'HOOK_TOO_LONG')
  assert.equal(generated, 0)
})

for (const refusal of ['database', 'quota']) test(`provider gates fail closed on ${refusal} refusal`, async () => {
  let calls = 0
  const load = loader({
    'lib/db.ts': { transaction: async work => {
      if (refusal === 'database') throw new Error('synthetic DB failure')
      return work({ query: async () => ({ rows: [] }) })
    } },
    '@ai-sdk/openai': { createOpenAI: () => ({ chat: () => ({}) }) },
    ai: { generateText: async () => { calls++ }, Output: { object: () => ({}) } },
  }, { process: { env: { DOMI_ADMISSION_ENABLED: 'true', NEBIUS_API_KEY: 'synthetic', LINKUP_API_KEY: 'synthetic' } },
    fetch: async () => { calls++; throw new Error('must not be reached') },
  })
  const status = refusal === 'database' ? 503 : 429
  await assert.rejects(load('lib/nebius.ts').generateStructured({ system: '', prompt: '', schema: {} }), { status })
  await assert.rejects(load('lib/linkup.ts').research('synthetic'), { status })
  assert.equal(calls, 0)
})
