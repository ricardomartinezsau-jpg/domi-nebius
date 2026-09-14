// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { timingSafeEqual } from 'node:crypto'
import { queryOne } from './db.ts'
import { runStep } from './research-execution.ts'

/**
 * A deliberately narrow switch used only in the live retry demonstration.
 *
 * The browser never sees the token. The web service checks it once, then
 * writes a boolean marker alongside the run input. The workflow reads that
 * durable marker, so a task retry cannot accidentally target another run.
 */
const DEMO_TOKEN_HEADER = 'x-domi-demo-fault-token'
export const DEMO_FAULT_STEP = 'demo-fault'

function enabled() {
  return process.env.DOMI_DEMO_FAULT_ENABLED === 'true'
}

/** True only for an operator request authenticated by a server-side secret. */
export function requestedDemoFault(request: Pick<Request, 'headers'>): boolean {
  if (!enabled()) return false
  const expected = process.env.DOMI_DEMO_FAULT_TOKEN?.trim()
  const received = request.headers.get(DEMO_TOKEN_HEADER)
  if (!expected || expected.length < 32 || !received) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

function markedForDemo(steps: unknown): boolean {
  if (!Array.isArray(steps)) return false
  const first = steps[0]
  return typeof first === 'object' && first !== null && (first as { demoFault?: unknown }).demoFault === true
}

async function demoFaultMarkedForRun(runId: string): Promise<boolean> {
  const row = await queryOne<{ steps: unknown }>('SELECT steps FROM runs WHERE id = $1', [runId])
  return markedForDemo(row?.steps)
}

/**
 * The workflow gate is the durable marker itself. Only the web service can
 * create it, after its env gate and constant-time token check pass. This lets
 * the worker recover without carrying a second secret or config toggle.
 */
export async function demoFaultEnabledForRun(runId: string): Promise<boolean> {
  return demoFaultMarkedForRun(runId)
}

/**
 * Runs after search-1 has committed its question and findings. Attempt 1
 * throws; Render retries this task, and attempt 2 commits a result into the
 * same (run_id, step) row. The attempt counter is our durable one-time fuse.
 */
export async function executeDemoFault(runId: string) {
  // Defense in depth for an accidental direct task invocation: an ordinary
  // run cannot trip the fault merely because this task name is registered.
  if (!await demoFaultMarkedForRun(runId)) return { skipped: true }
  return runStep(runId, DEMO_FAULT_STEP, async (attempt) => {
    if (attempt === 1) {
      const error = new Error('DEMO_FAULT_ONCE')
      error.name = 'DemoFaultError'
      throw error
    }
    return { recovered: true }
  })
}
