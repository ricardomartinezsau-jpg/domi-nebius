// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { AsyncLocalStorage } from 'node:async_hooks'
import { transaction, type SqlClient } from './db.ts'
import { assertAdmission, LIMITS } from './admission.ts'
import { PolicyError, logFailure, withContext } from './operations.ts'

const execution = new AsyncLocalStorage<{ runId: string; generation: number }>()
export class StepBusyError extends Error {
  constructor(step: string) { super(`Busy: ${step}`); this.name = 'StepBusyError' }
}
export class StaleExecutionError extends Error {
  constructor() { super('Execution no longer owns its lease'); this.name = 'StaleExecutionError' }
}
export function withExecution<T>(runId: string, generation: number, work: () => T): T {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new PolicyError(503, 'EXECUTION_VERSION_REQUIRED')
  return withContext({ runId, generation }, () => execution.run({ runId, generation }, work))
}
export function currentGeneration(runId: string) {
  const current = execution.getStore()
  if (!current || current.runId !== runId) throw new PolicyError(503, 'EXECUTION_CONTEXT_REQUIRED')
  return current.generation
}
export async function lockCurrentRun(client: SqlClient, runId: string, allowDone = false) {
  const generation = currentGeneration(runId)
  const row = (await client.query('SELECT generation, status, guest_owner FROM runs WHERE id = $1 FOR UPDATE', [runId])).rows[0]
  if (!row || !row.guest_owner || row.generation !== generation ||
      (!['queued', 'running'].includes(row.status) && !(allowDone && row.status === 'done'))) throw new StaleExecutionError()
  return row
}

export function safeRunError(error: unknown) {
  return error instanceof PolicyError ? error.code : 'RESEARCH_STEP_FAILED'
}

/** External work runs WITHOUT a transaction. Claim + commit each lock run before step. */
/** The attempt comes from the persisted step ledger, never process memory. */
export async function runStep<W, R = W>(runId: string, step: string, work: (attempt: number) => Promise<W>, persist?: (client: SqlClient, value: W) => Promise<R>): Promise<R> {
  assertAdmission()
  const generation = currentGeneration(runId)
  const claim = await transaction(async client => {
    const run = await lockCurrentRun(client, runId, true)
    const existing = (await client.query("SELECT status, result, attempt, started_at < now() - interval '5 minutes' AS expired FROM run_steps WHERE run_id = $1 AND step = $2", [runId, step])).rows[0]
    if (existing?.status === 'done') return { cached: existing.result as R }
    if (run.status === 'done') throw new StaleExecutionError()
    const claimed = (await client.query(`INSERT INTO run_steps (run_id, step, status, attempt, generation)
      VALUES ($1, $2, 'running', 1, $3)
      ON CONFLICT (run_id, step) DO UPDATE SET status = 'running', attempt = run_steps.attempt + 1,
        generation = EXCLUDED.generation, error = NULL, started_at = now(), finished_at = NULL
      WHERE run_steps.attempt < $4 AND (run_steps.status = 'failed' OR run_steps.generation <> $3
        OR (run_steps.status = 'running' AND run_steps.started_at < now() - interval '5 minutes'))
      RETURNING attempt`, [runId, step, generation, LIMITS.stepAttempts])).rows[0]
    if (!claimed) {
      if (existing?.attempt >= LIMITS.stepAttempts && (existing.status === 'failed' || existing.expired)) throw new PolicyError(409, 'ATTEMPTS_EXHAUSTED')
      throw new StepBusyError(step)
    }
    // A fenced worker claiming the task is positive evidence of executor acceptance.
    await client.query(`UPDATE runs SET status = 'running', current_step = $2, dispatch_state = 'accepted' WHERE id = $1`, [runId, step])
    return { attempt: claimed.attempt as number }
  })
  if ('cached' in claim) return claim.cached as R
  const attempt = claim.attempt
  const ownsStep = async (client: SqlClient) => {
    await lockCurrentRun(client, runId)
    const row = (await client.query(`SELECT attempt FROM run_steps WHERE run_id = $1 AND step = $2
      AND status = 'running' AND attempt = $3 AND generation = $4
      AND started_at >= now() - interval '5 minutes' FOR UPDATE`, [runId, step, attempt, generation])).rows[0]
    if (!row) throw new StaleExecutionError()
  }
  return withContext({ step, attempt }, async () => {
    try {
      const value = await work(attempt)
      return await transaction(async client => {
        await ownsStep(client)
        const result = persist ? await persist(client, value) : value as unknown as R
        await client.query(`UPDATE run_steps SET status = 'done', result = $5::jsonb, error = NULL, finished_at = now()
          WHERE run_id = $1 AND step = $2 AND attempt = $3 AND generation = $4 AND status = 'running'`,
        [runId, step, attempt, generation, JSON.stringify(result ?? null)])
        return result
      })
    } catch (error) {
      logFailure('research.step', error)
      if (error instanceof StaleExecutionError) throw error
      try {
        await transaction(async client => {
          await ownsStep(client)
          await client.query(`UPDATE run_steps SET status = 'failed', error = $5, finished_at = now()
            WHERE run_id = $1 AND step = $2 AND attempt = $3 AND generation = $4 AND status = 'running'`,
          [runId, step, attempt, generation, safeRunError(error)])
        })
      } catch (secondary) {
        logFailure('research.step.failure_persist', secondary)
        if (secondary instanceof StaleExecutionError) throw secondary
      }
      throw error
    }
  })
}
