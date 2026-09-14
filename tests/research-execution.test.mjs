// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loader } from './load-ts.mjs'

function harness() {
  const state = { generation: 1, attempt: 0, status: null, result: null, writes: [], inTx: false, lose: false }
  const client = { query: async (sql, params) => {
    if (sql.includes('SELECT generation')) return { rows: [{ generation: state.generation, status: 'running', guest_owner: 'owner' }] }
    if (sql.includes('SELECT status, result')) return { rows: state.status ? [{ status: state.status, result: state.result, attempt: state.attempt }] : [] }
    if (sql.includes('INSERT INTO run_steps')) {
      if (state.status === 'running') return { rows: [] }
      state.status = 'running'; state.attempt++
      return { rows: [{ attempt: state.attempt }] }
    }
    if (sql.includes('SELECT attempt')) return { rows: state.lose ? [] : [{ attempt: state.attempt }] }
    if (sql.includes("status = 'done'")) { state.status = 'done'; state.result = JSON.parse(params[4]); state.writes.push('done') }
    if (sql.includes("status = 'failed'")) { state.status = 'failed'; state.writes.push('failed') }
    return { rows: [] }
  } }
  const db = { transaction: async work => {
    assert.equal(state.inTx, false)
    state.inTx = true
    const previous = structuredClone(state)
    try { return await work(client) }
    catch (e) { Object.assign(state, previous); throw e }
    finally { state.inTx = false }
  } }
  const api = loader({ 'lib/db.ts': db })('lib/research-execution.ts')
  return { state, api }
}

test('provider runs outside a transaction; persistence and done share one transaction', async () => {
  const { state, api } = harness()
  const result = await api.withExecution('run', 1, () => api.runStep('run', 'search-1', async () => {
    assert.equal(state.inTx, false); return 'paid'
  }, async (_client, value) => { assert.equal(state.inTx, true); state.writes.push('findings'); return value }))
  assert.equal(result, 'paid')
  assert.deepEqual(state.writes, ['findings', 'done'])
  assert.equal(await api.withExecution('run', 1, () => api.runStep('run', 'search-1', async () => { throw new Error('must reuse') })), 'paid')
})

test('partial persistence rolls back, then records a retryable step failure', async () => {
  const { state, api } = harness()
  await assert.rejects(api.withExecution('run', 1, () => api.runStep('run', 'search-1', async () => 'paid', async () => {
    state.writes.push('question'); state.writes.push('source'); throw new Error('injected before done')
  })))
  assert.deepEqual(state.writes, ['failed'])
  assert.equal(state.status, 'failed')
})

test('stale attempt cannot persist findings, success or failure', async () => {
  const { state, api } = harness()
  await assert.rejects(api.withExecution('run', 1, () => api.runStep('run', 'guide', async () => {
    state.lose = true; return 'late'
  }, async () => { state.writes.push('incorrect'); return 'late' })), { name: 'StaleExecutionError' })
  assert.deepEqual(state.writes, [])
})

test('stale generation cannot claim a step or reach a provider', async () => {
  const { state, api } = harness()
  state.generation = 2
  await assert.rejects(api.withExecution('run', 1, () => api.runStep('run', 'guide', async () => { throw new Error('provider reached') })), { name: 'StaleExecutionError' })
  assert.equal(state.attempt, 0)
})

test('busy step does not invoke provider or mark a failure', async () => {
  const { state, api } = harness()
  state.status = 'running'; state.attempt = 1
  await assert.rejects(api.withExecution('run', 1, () => api.runStep('run', 'guide', async () => { throw new Error('provider reached') })), { name: 'StepBusyError' })
  assert.deepEqual(state.writes, [])
})
