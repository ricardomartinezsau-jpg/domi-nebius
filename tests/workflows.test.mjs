import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'

function setup() {
  let failed = 0
  const load = loader({
    'lib/db.ts': {},
    'lib/research.ts': { markRunFailed: async () => { failed++ } },
    '@renderinc/sdk/workflows': { task: (_options, work) => work },
  })
  return { api: load('lib/workflows.ts'), execution: load('lib/research-execution.ts'), ops: load('lib/operations.ts'), failed: () => failed }
}

test('busy outcome survives JSON transport and is not marked failed', async () => {
  const { api, execution, failed } = setup()
  const outcome = JSON.parse(JSON.stringify(await api.stepOutcome('run', 1, 'correlation', async () => { throw new execution.StepBusyError('guide') })))
  assert.equal(outcome.kind, 'busy')
  let calls = 0
  const result = await api.researchWorkflow({ run: async () => { calls++; return outcome } }, 'run', 1, 'correlation')
  assert.equal(result.ok, false)
  assert.equal(result.outcome, 'busy')
  assert.equal(calls, 1)
  assert.equal(failed(), 0)
})

test('exhausted budget is serialized as permanent failure, not retried by SDK', async () => {
  const { api, ops, failed } = setup()
  const result = await api.stepOutcome('run', 1, 'correlation', async () => { throw new ops.PolicyError(429, 'QUOTA_EXHAUSTED') })
  assert.equal(result.kind, 'stopped')
  assert.equal(failed(), 1)
})

test('old workflow arguments cannot execute an unfenced step', async () => {
  const { api } = setup()
  await assert.rejects(api.stepOutcome('run', undefined, 'correlation', async () => { throw new Error('provider must not run') }), { code: 'EXECUTION_VERSION_REQUIRED' })
})

test('late failure cannot degrade a completed run', async () => {
  let writes = 0
  const load = loader({ 'lib/db.ts': { transaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT generation')) return { rows: [{ generation: 1, status: 'done', guest_owner: 'owner' }] }
    writes++; throw new Error('completed run cannot be changed')
  } }) } })
  const api = load('lib/research.ts')
  await load('lib/research-execution.ts').withExecution('run', 1, () => api.markRunFailed('run', new Error('late')))
  assert.equal(writes, 0)
})

test('finishRun requires all five persisted steps before declaring success', async () => {
  let writes = 0
  const load = loader({ 'lib/db.ts': { transaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT generation')) return { rows: [{ generation: 1, status: 'running', guest_owner: 'owner' }] }
    if (sql.includes('count(*)::int')) return { rows: [{ n: 4 }] }
    writes++; throw new Error('success must not be written')
  } }) } })
  await assert.rejects(load('lib/research-execution.ts').withExecution('run', 1, () => load('lib/research.ts').finishRun('run')), { code: 'INCOMPLETE_STEPS' })
  assert.equal(writes, 0)
})

test('a guide emptied by grounding never reaches the done persistence point', async () => {
  let saved = false
  const load = loader({
    'lib/db.ts': { queryOne: async sql => sql.includes('SELECT steps') ? { steps: [{ input: { taskTitle: 'synthetic', blocker: 'synthetic', locale: 'es' } }] } : { result: {} }, query: async () => [] },
    'lib/nebius.ts': { RESEARCH_MODEL: 'synthetic', generateStructured: async () => ({ output: { steps: [{ title: 'step', detail: 'detail', sourceUrls: ['https://invented.example'] }], unconfirmed: [] } }) },
    'lib/research-execution.ts': { runStep: async (_run, _step, work) => { const result = await work(); saved = true; return result } },
  })
  await assert.rejects(load('lib/research.ts').executeGuide('run'), { code: 'UNGROUNDED_GUIDE' })
  assert.equal(saved, false)
})
