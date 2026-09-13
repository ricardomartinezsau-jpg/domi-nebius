import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'

test('ownership is checked before any child data is read', async () => {
  const calls = []
  const load = loader({ 'lib/db.ts': {
    queryOne: async (sql, params) => { calls.push({ sql, params }); return null },
    query: async () => { throw new Error('Child data must not be queried') },
  } })
  assert.equal(await load('lib/research.ts').readResearch('known-uuid', 'visitor-B'), null)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /guest_owner = \$2/)
  assert.deepEqual(Array.from(calls[0].params), ['known-uuid', 'visitor-B'])
})

test('idempotent creation returns the original run without consuming quotas', async () => {
  let queries = 0
  const load = loader({ 'lib/db.ts': { transaction: async fn => fn({ query: async sql => {
    queries++
    if (sql.includes('pg_advisory')) return { rows: [] }
    if (sql.includes('request_hash')) return { rows: [{ id: 'original', request_hash: hash }] }
    throw new Error('No inserts or quotas on replay')
  } }) } })
  const api = load('lib/research-lifecycle.ts')
  const input = { taskTitle: 'task', blocker: 'blocker', locale: 'es' }
  const hash = api.inputHash(input)
  assert.equal(await api.createResearchRun(input, 'visitor-A', 'key-1234567890123456', 'shared'), 'original')
  await assert.rejects(api.createResearchRun({ ...input, blocker: 'other' }, 'visitor-A', 'key-1234567890123456', 'shared'), { status: 409 })
  assert.equal(queries, 4)
})

for (const state of ['sending', 'unknown', 'accepted']) test(`dispatch ${state} does not enqueue a duplicate`, async () => {
  const load = loader({ 'lib/db.ts': { transaction: async fn => fn({ query: async sql => {
    if (sql.includes('pg_advisory')) return { rows: [] }
    if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'running', dispatch_state: state, recent: true, generation: 2 }] }
    throw new Error('Duplicate dispatch or reservation')
  } }) } })
  assert.equal((await load('lib/research-lifecycle.ts').claimDispatch('run', 'owner', true)).claimed, false)
})

test('confirmed Render acceptance followed by a DB failure never runs local', async () => {
  let local = 0
  const load = loader({
    'lib/research-lifecycle.ts': { claimDispatch: async () => ({ claimed: true, generation: 1 }) },
    'lib/db.ts': { query: async () => { throw new Error('synthetic DB failure') } },
    'lib/research.ts': { advanceResearch: async () => { local++ } },
    '@renderinc/sdk': { Render: class { workflows = { startTask: async () => ({ taskRunId: 'task' }) } } },
  }, { process: { env: { RENDER_API_KEY: 'synthetic', NODE_ENV: 'production' } } })
  assert.equal((await load('lib/research-dispatch.ts').dispatchResearch('run', 'owner')).accepted, true)
  assert.equal(local, 0)
})

for (const mode of ['timeout', 'missing-id']) test(`ambiguous Render acceptance (${mode}) blocks redispatch and never runs local`, async () => {
  let local = 0; let state
  const load = loader({
    'lib/research-lifecycle.ts': { claimDispatch: async () => ({ claimed: true, generation: 1 }) },
    'lib/db.ts': { query: async (_sql, params) => { state = params[2] } },
    'lib/research.ts': { advanceResearch: async () => { local++ } },
    '@renderinc/sdk': { Render: class { workflows = { startTask: async () => { if (mode === 'timeout') throw new Error('timeout'); return {} } } } },
  }, { process: { env: { RENDER_API_KEY: 'synthetic', NODE_ENV: 'production' } } })
  const result = await load('lib/research-dispatch.ts').dispatchResearch('run', 'owner')
  assert.equal(result.accepted, false)
  assert.equal(result.dispatchState, 'unknown')
  assert.equal(state, 'unknown')
  assert.equal(local, 0)
})
