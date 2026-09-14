import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'

function setup({ demoFault = false } = {}) {
  let failed = 0
  const load = loader({
    'lib/db.ts': {},
    'lib/research.ts': { markRunFailed: async () => { failed++ } },
    'lib/demo-fault.ts': { demoFaultEnabledForRun: async () => demoFault, executeDemoFault: async () => {} },
    '@renderinc/sdk/workflows': { task: (options, work) => Object.assign(work, { taskName: options.name }) },
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

test('the selected demo task runs only after search-1 has persisted', async () => {
  const { api } = setup({ demoFault: true })
  const seen = []
  const result = await api.researchWorkflow({ run: async step => {
    seen.push(step.taskName)
    return { kind: 'done' }
  } }, 'run', 1, 'correlation')
  assert.equal(result.ok, true)
  assert.deepEqual(seen, ['questionOne', 'searchOne', 'demoFault', 'gap', 'searchTwo', 'guide', 'finish'])
})

test('ordinary runs do not register a demo-fault task', async () => {
  const { api } = setup()
  const seen = []
  await api.researchWorkflow({ run: async step => {
    seen.push(step.taskName)
    return { kind: 'done' }
  } }, 'run', 1, 'correlation')
  assert.equal(seen.includes('demoFault'), false)
})

test('only a server-gated marker can trigger a one-time demo retry', async () => {
  const runId = 'c2e9c623-8016-4b43-a4e3-9955b8c99fb2'
  let attempt = 0
  const enabled = loader({
    'lib/db.ts': { queryOne: async () => ({ steps: [{ demoFault: true }] }) },
    'lib/research-execution.ts': { runStep: async (id, step, work) => {
      assert.equal(id, runId); assert.equal(step, 'demo-fault')
      attempt++
      return work(attempt)
    } },
  }, { process: { env: { DOMI_DEMO_FAULT_ENABLED: 'true', DOMI_DEMO_FAULT_TOKEN: '0123456789abcdef0123456789abcdef' } } })('lib/demo-fault.ts')
  const valid = new Headers({ 'x-domi-demo-fault-token': '0123456789abcdef0123456789abcdef' })
  assert.equal(enabled.requestedDemoFault({ headers: valid }), true)
  assert.equal(enabled.requestedDemoFault({ headers: new Headers({ 'x-domi-demo-fault-token': 'wrong' }) }), false)
  assert.equal(await enabled.demoFaultEnabledForRun(runId), true)
  await assert.rejects(enabled.executeDemoFault(runId), { name: 'DemoFaultError', message: 'DEMO_FAULT_ONCE' })
  assert.equal((await enabled.executeDemoFault(runId)).recovered, true)
  assert.equal(attempt, 2)

  const disabled = loader({ 'lib/db.ts': { queryOne: async () => ({ steps: [{ demoFault: true }] }) } },
    { process: { env: { DOMI_DEMO_FAULT_ENABLED: 'false', DOMI_DEMO_FAULT_TOKEN: '0123456789abcdef0123456789abcdef' } } })('lib/demo-fault.ts')
  assert.equal(disabled.requestedDemoFault({ headers: valid }), false)
  assert.equal(await disabled.demoFaultEnabledForRun(runId), true)

  let executed = false
  const unmarked = loader({
    'lib/db.ts': { queryOne: async () => ({ steps: [{ input: {} }] }) },
    'lib/research-execution.ts': { runStep: async () => { executed = true } },
  }, { process: { env: { DOMI_DEMO_FAULT_ENABLED: 'true' } } })('lib/demo-fault.ts')
  assert.equal((await unmarked.executeDemoFault(runId)).skipped, true)
  assert.equal(executed, false)
})
