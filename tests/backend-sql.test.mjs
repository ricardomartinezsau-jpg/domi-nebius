import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { loader } from './load-ts.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// Never fall back to DATABASE_URL or load dotenv. Requires an explicitly disposable
// loopback database. Only our random schema is created/dropped, never public.
const configured = process.env.DOMI_TEST_DATABASE_URL
test('PostgreSQL: atomic quotas, ownership, claims, fencing and round rollback', { skip: !configured && 'Disposable PostgreSQL not configured' }, async t => {
  const url = new URL(configured)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'SQL tests require literal loopback')
  assert.match(url.pathname, /^\/domi_test[a-z0-9_]*$/)
  assert.equal(url.search, '', 'Connection URL overrides are prohibited')
  assert.equal(process.env.DOMI_TEST_DB_ALLOW_WRITE, 'synthetic-only')
  const schema = `domi_test_${randomUUID().replaceAll('-', '')}`
  assert.match(schema, /^domi_test_[a-f0-9]{32}$/)
  const admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 3000 })
  await admin.connect()
  let appDb
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    await admin.query(`SET search_path TO "${schema}"`)
    // Minimal runs fixture, not a claim that auth/vector migrations are validated.
    await admin.query(`CREATE TABLE runs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      anonymous BOOLEAN NOT NULL DEFAULT false, model TEXT NOT NULL, steps JSONB NOT NULL DEFAULT '[]',
      ok BOOLEAN NOT NULL DEFAULT false, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    for (const file of ['0003_research.sql', '0004_render_workflows.sql', '0005_research_locks.sql', '0006_run_ok_starts_false.sql', '0007_admission_and_execution.sql']) {
      await admin.query(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'))
    }
    url.searchParams.set('options', `-c search_path=${schema}`)
    process.env.DATABASE_URL = url.toString()
    process.env.DATABASE_SSL = ''
    process.env.DOMI_ADMISSION_ENABLED = 'true'
    appDb = await import('../lib/db.ts')
    const admission = await import('../lib/admission.ts')
    const lifecycle = await import('../lib/research-lifecycle.ts')
    const execution = await import('../lib/research-execution.ts')
    const input = { taskTitle: 'synthetic task', blocker: 'synthetic blocker', locale: 'es' }

    await t.test('parallel connections cannot overspend a shared counter', async () => {
      const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => appDb.transaction(client => admission.reserveLimits(client, [{ key: 'test:shared', seconds: 86400, units: 1, limit: 3 }]))))
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 3)
      assert.equal((await admin.query("SELECT used FROM admission_counters WHERE bucket_key = 'test:shared'")).rows[0].used, 3)
    })

    await t.test('independent processes share the same persistent budget', async () => {
      const code = `import { reserve } from './lib/admission.ts'; import { db } from './lib/db.ts';
        try { await reserve([{key:'test:processes',seconds:86400,limit:2}]); }
        catch(e) { process.exitCode = e.status === 429 ? 2 : 3; } finally { await db().end(); }`
      const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, DATABASE_URL: url.toString(), DOMI_ADMISSION_ENABLED: 'true', DATABASE_SSL: '' }
      const results = await Promise.all(Array.from({ length: 6 }, async () => {
        try { await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, windowsHide: true }); return 0 }
        catch (error) { return error.code }
      }))
      assert.equal(results.filter(code => code === 0).length, 2)
      assert.equal(results.filter(code => code === 2).length, 4)
    })

    let runId
    await t.test('parallel identical creates reserve one run; owner and payload cannot be changed', async () => {
      const ids = await Promise.all(Array.from({ length: 8 }, () => lifecycle.createResearchRun(input, 'owner-A', 'synthetic-key-123456', 'shared')))
      assert.equal(new Set(ids).size, 1); runId = ids[0]
      await assert.rejects(lifecycle.createResearchRun({ ...input, blocker: 'changed' }, 'owner-A', 'synthetic-key-123456', 'shared'), { status: 409 })
      await assert.rejects(lifecycle.claimDispatch(runId, 'owner-B', true), { status: 404 })
      const counts = (await admin.query("SELECT used FROM admission_counters WHERE bucket_key = 'research:guest:owner-A'")).rows
      assert.equal(counts[0].used, 1)
    })

    await t.test('one dispatch and one live step winner', async () => {
      const claims = await Promise.all(Array.from({ length: 8 }, () => lifecycle.claimDispatch(runId, 'owner-A', true)))
      assert.equal(claims.filter(c => c.claimed).length, 1)
      let release; let entered
      const gate = new Promise(resolve => { release = resolve })
      const started = new Promise(resolve => { entered = resolve })
      const winner = execution.withExecution(runId, 1, () => execution.runStep(runId, 'question-1', async () => { entered(); await gate; return { question: 'synthetic?', askedBecause: 'synthetic' } }))
      await started
      await assert.rejects(execution.withExecution(runId, 1, () => execution.runStep(runId, 'question-1', async () => { throw new Error('duplicate provider') })), { name: 'StepBusyError' })
      release(); await winner
    })

    await t.test('lease takeover prevents old response from overwriting new output', async () => {
      let release; let entered
      const gate = new Promise(resolve => { release = resolve })
      const started = new Promise(resolve => { entered = resolve })
      const old = execution.withExecution(runId, 1, () => execution.runStep(runId, 'gap', async () => { entered(); await gate; return 'old' }))
      await started
      await admin.query("UPDATE run_steps SET started_at = now() - interval '6 minutes' WHERE run_id = $1 AND step = 'gap'", [runId])
      await execution.withExecution(runId, 1, () => execution.runStep(runId, 'gap', async () => 'new'))
      release(); await assert.rejects(old, { name: 'StaleExecutionError' })
      assert.equal((await admin.query("SELECT result FROM run_steps WHERE run_id = $1 AND step = 'gap'", [runId])).rows[0].result, 'new')
    })

    await t.test('failure between sources rolls back the entire round; retry saves unique count', async () => {
      let fail = true; let insert = 0
      const load = loader({
        'lib/db.ts': { ...appDb, transaction: work => appDb.transaction(client => work({ query: async (sql, params) => {
          if (sql.includes('INSERT INTO findings') && fail && ++insert === 2) throw new Error('synthetic source failure')
          return client.query(sql, params)
        } })) },
        'lib/linkup.ts': { confidenceFrom: () => 'strong', research: async () => ({ answer: 'synthetic answer', sources: [
          { url: 'https://a.example/1', name: 'a', snippet: 'a' }, { url: 'https://b.example/2', name: 'b', snippet: 'b' }, { url: 'https://a.example/1', name: 'a', snippet: 'a' },
        ] }) },
      })
      const execute = () => load('lib/research-execution.ts').withExecution(runId, 1, () => load('lib/research.ts').executeSearchOne(runId))
      await assert.rejects(execute())
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM research_questions WHERE run_id = $1', [runId])).rows[0].n, 0)
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM findings WHERE run_id = $1', [runId])).rows[0].n, 0)
      fail = false
      assert.equal((await execute()).sources, 2)
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM findings WHERE run_id = $1', [runId])).rows[0].n, 2)
    })

    await t.test('the accumulated attempt limit prevents a fifth provider invocation', async () => {
      let calls = 0
      for (let i = 0; i < 4; i++) await assert.rejects(execution.withExecution(runId, 1, () => execution.runStep(runId, 'attempt-test', async () => { calls++; throw new Error('synthetic provider failure') })))
      await assert.rejects(execution.withExecution(runId, 1, () => execution.runStep(runId, 'attempt-test', async () => { calls++ })), { code: 'ATTEMPTS_EXHAUSTED' })
      assert.equal(calls, 4)
    })
  } finally {
    if (appDb) await appDb.db().end()
    // Exact, validated, newly created synthetic schema only. Not a production cleanup.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
})
