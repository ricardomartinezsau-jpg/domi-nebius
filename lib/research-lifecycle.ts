// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { createHash } from 'node:crypto'
import { transaction, type SqlClient } from './db.ts'
import { assertAdmission, daily, LIMITS, researchLimits, reserveLimits } from './admission.ts'
import { PolicyError, requestId } from './operations.ts'
import { RESEARCH_MODEL } from './nebius.ts'
import type { ResearchInput } from './research.ts'

export type CreateResearchOptions = { demoFault?: boolean }

export function inputHash(input: ResearchInput, options: CreateResearchOptions = {}) {
  return createHash('sha256').update(JSON.stringify({ taskTitle: input.taskTitle?.trim() || null,
    contextArea: input.contextArea ?? null, blocker: input.blocker.trim(), locale: input.locale,
    // Keep an operator-selected demo run distinct from an ordinary idempotent request.
    demoFault: options.demoFault === true })).digest('hex')
}
export async function lockOwner(client: SqlClient, owner: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`domi:owner:${owner}`])
}
export async function createResearchRun(input: ResearchInput, owner: string, key: string, ip: string, options: CreateResearchOptions = {}): Promise<string> {
  assertAdmission()
  if (!owner || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new PolicyError(400, 'IDEMPOTENCY_KEY_REQUIRED')
  const hash = inputHash(input, options)
  return transaction(async client => {
    await lockOwner(client, owner)
    const previous = (await client.query('SELECT id, request_hash FROM runs WHERE guest_owner = $1 AND idempotency_key = $2', [owner, key])).rows[0]
    if (previous) {
      if (previous.request_hash !== hash) throw new PolicyError(409, 'IDEMPOTENCY_CONFLICT')
      return previous.id as string
    }
    const active = await client.query(`SELECT id FROM runs WHERE guest_owner = $1
      AND (status IN ('queued', 'running') OR dispatch_state IN ('sending', 'unknown')) LIMIT 1`, [owner])
    if (active.rows.length) throw new PolicyError(429, 'ACTIVE_RESEARCH_LIMIT', 60)
    await reserveLimits(client, researchLimits(owner, ip))
    const row = (await client.query(`INSERT INTO runs
      (anonymous, model, status, current_step, steps, guest_owner, idempotency_key, request_hash, correlation_id)
      VALUES (true, $1, 'queued', 'question-1', $2::jsonb, $3, $4, $5, $6) RETURNING id`,
    [RESEARCH_MODEL, JSON.stringify([{ input, ...(options.demoFault === true ? { demoFault: true } : {}) }]), owner, key, hash, requestId()])).rows[0]
    return row.id as string
  })
}
export type DispatchClaim = { claimed: boolean; generation: number; state: string }
export async function claimDispatch(runId: string, owner: string, remote: boolean): Promise<DispatchClaim> {
  assertAdmission()
  return transaction(async client => {
    await lockOwner(client, owner)
    const run = (await client.query(`SELECT *, dispatch_started_at > now() - interval '25 minutes' AS recent
      FROM runs WHERE id = $1 AND guest_owner = $2 FOR UPDATE`, [runId, owner])).rows[0]
    if (!run) throw new PolicyError(404, 'NOT_FOUND')
    if (run.status === 'done') return { claimed: false, generation: run.generation, state: 'done' }
    if (!remote && process.env.NODE_ENV === 'production') throw new PolicyError(503, 'WORKFLOW_NOT_CONFIGURED')
    // Elapsed time cannot establish non-acceptance; an operator must reconcile these.
    if (['sending', 'unknown'].includes(run.dispatch_state)) return { claimed: false, generation: run.generation, state: 'unknown' }
    if (run.dispatch_state === 'accepted' && run.recent && run.status !== 'failed') return { claimed: false, generation: run.generation, state: 'accepted' }
    const busy = await client.query(`SELECT step FROM run_steps WHERE run_id = $1 AND status = 'running'
      AND started_at >= now() - interval '5 minutes' LIMIT 1`, [runId])
    if (busy.rows.length) return { claimed: false, generation: run.generation, state: 'accepted' }
    const exhausted = await client.query(`SELECT step FROM run_steps WHERE run_id = $1 AND status <> 'done' AND attempt >= $2 LIMIT 1`, [runId, LIMITS.stepAttempts])
    if (exhausted.rows.length) throw new PolicyError(409, 'ATTEMPTS_EXHAUSTED')
    const active = await client.query(`SELECT id FROM runs WHERE guest_owner = $1 AND id <> $2
      AND (status IN ('queued', 'running') OR dispatch_state IN ('sending', 'unknown')) LIMIT 1`, [owner, runId])
    if (active.rows.length) throw new PolicyError(429, 'ACTIVE_RESEARCH_LIMIT', 60)
    if (remote) await reserveLimits(client, [daily('global:render', LIMITS.render)])
    const row = (await client.query(`UPDATE runs SET generation = generation + 1, dispatch_state = 'sending',
      dispatch_started_at = now(), status = 'queued', ok = false, error = NULL, task_run_id = NULL,
      correlation_id = $2 WHERE id = $1 RETURNING generation`, [runId, requestId()])).rows[0]
    return { claimed: true, generation: row.generation, state: 'sending' }
  })
}
