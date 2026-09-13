import { Render } from '@renderinc/sdk'
import { claimDispatch } from './research-lifecycle.ts'
import { query } from './db.ts'
import { advanceResearch } from './research.ts'
import { PolicyError, logFailure, requestId, withContext } from './operations.ts'

export async function dispatchResearch(runId: string, owner: string) {
  const token = process.env.RENDER_API_KEY?.trim()
  const claim = await claimDispatch(runId, owner, Boolean(token))
  if (!claim.claimed) return { runId, accepted: claim.state !== 'unknown', dispatchState: claim.state }
  const { generation } = claim
  return withContext({ runId, generation }, async () => {
    if (!token) {
      // Development only: persisted intent, but process-local execution is not durable.
      await query(`UPDATE runs SET dispatch_state = 'accepted' WHERE id = $1 AND generation = $2`, [runId, generation])
      void advanceResearch(runId, generation).catch(error => logFailure('research.local', error))
      return { runId, accepted: true, dispatchState: 'local' }
    }
    let taskRunId: string
    try {
      const render = new Render({ token })
      taskRunId = (await render.workflows.startTask(`${process.env.RENDER_WORKFLOW_SLUG || 'domi-research'}/research`,
        [runId, generation, requestId()], AbortSignal.timeout(15_000))).taskRunId
    } catch (error) {
      logFailure('research.dispatch', error)
      const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode
      const rejected = typeof status === 'number' && [400, 401, 403, 404, 422, 429].includes(status)
      try {
        await query(`UPDATE runs SET dispatch_state = $3, status = $4, error = $5
          WHERE id = $1 AND generation = $2 AND dispatch_state = 'sending' AND status = 'queued'`,
        [runId, generation, rejected ? 'rejected' : 'unknown', rejected ? 'failed' : 'queued', rejected ? 'WORKFLOW_REJECTED' : 'ACCEPTANCE_UNKNOWN'])
      } catch (secondary) { logFailure('research.dispatch.persist', secondary) }
      return { runId, accepted: false, dispatchState: rejected ? 'rejected' : 'unknown' }
    }
    try {
      await query(`UPDATE runs SET task_run_id = $3, dispatch_state = 'accepted' WHERE id = $1 AND generation = $2`, [runId, generation, taskRunId])
    } catch (error) {
      logFailure('research.dispatch.accepted_persist_failed', error)
      // Acceptance is confirmed. Retain 'sending' as a durable redispatch block.
    }
    return { runId, accepted: true, dispatchState: 'accepted' }
  })
}
