import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'

test('logging retains correlation and status but excludes secret-bearing fields', () => {
  const lines = []
  const api = loader({}, { console: { error: value => lines.push(value) } })('lib/operations.ts')
  const error = Object.assign(new Error('CANARY_PROMPT'), { name: 'CANARY_NAME', code: 'CANARY_CODE', statusCode: 502, body: 'CANARY_BODY', headers: { authorization: 'CANARY_KEY' } })
  api.withContext({ requestId: 'request-123', phase: 'quick' }, () => api.logFailure('triage.request', error, 50))
  assert.equal(lines.length, 1)
  assert.doesNotMatch(lines[0], /CANARY/)
  assert.equal(JSON.parse(lines[0]).requestId, 'request-123')
  assert.equal(JSON.parse(lines[0]).status, 502)
})

test('pool stays at five, bounds SQL and locks, and handles idle errors', async () => {
  let options; let listener
  const load = loader({ pg: { Pool: class {
    constructor(config) { options = config }
    on(event, fn) { assert.equal(event, 'error'); listener = fn }
  } } }, { console: { error() {} } })
  load('lib/db.ts').db()
  assert.equal(options.max, 5)
  assert.equal(options.statement_timeout, 10000)
  assert.equal(options.lock_timeout, 3000)
  assert.doesNotThrow(() => listener(new Error('idle')))
})

test('rollback failure preserves primary cause and destroys the borrowed connection', async () => {
  const primary = new Error('primary')
  let released
  const load = loader({ pg: { Pool: class {
    on() {}
    async connect() { return {
      query: async sql => { if (sql === 'ROLLBACK') throw new Error('secondary') },
      release: broken => { released = broken },
    } }
  } } }, { console: { error() {} } })
  await assert.rejects(load('lib/db.ts').transaction(async () => { throw primary }), error => error === primary)
  assert.equal(released, true)
})

test('successful transaction always commits and releases its connection', async () => {
  const calls = []
  const load = loader({ pg: { Pool: class {
    on() {}
    async connect() { return { query: async sql => { calls.push(sql) }, release: broken => calls.push(broken) } }
  } } })
  assert.equal(await load('lib/db.ts').transaction(async () => 42), 42)
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', false])
})
