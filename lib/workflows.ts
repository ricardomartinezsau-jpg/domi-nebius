import { task, type TaskContext } from '@renderinc/sdk/workflows'
import { executeQuestionOne, executeSearchOne, executeGap, executeSearchTwo, executeGuide, finishRun, markRunFailed } from './research.ts'
import { StepBusyError, StaleExecutionError, withExecution } from './research-execution.ts'
import { PolicyError, logFailure, withContext } from './operations.ts'
import { demoFaultEnabledForRun, executeDemoFault } from './demo-fault.ts'

type StepOutcome = { kind: 'done' | 'busy' | 'stopped'; code?: string }

/** Busy/permanent failures cross the SDK as data, not instanceof-dependent errors. */
export async function stepOutcome(runId: string, generation: number, correlation: string, work: () => Promise<unknown>): Promise<StepOutcome> {
  return withContext({ requestId: correlation }, () => withExecution(runId, generation, async () => {
    try { await work(); return { kind: 'done' } }
    catch (error) {
      if (error instanceof StepBusyError || error instanceof StaleExecutionError) return { kind: 'busy' }
      logFailure('workflow.step', error)
      if (error instanceof PolicyError) {
        try { await markRunFailed(runId, error) } catch (secondary) { logFailure('workflow.failure_persist', secondary) }
        return { kind: 'stopped', code: error.code }
      }
      // SDK exceptions can expose their message across processes. Send a fixed code only.
      throw new Error('RESEARCH_STEP_FAILED')
    }
  }))
}

function defineStep(name: string, work: (runId: string) => Promise<unknown>, timeoutSeconds = 120, maxRetries = 3) {
  return task({ name, retry: { maxRetries, waitDurationMs: 1000, backoffScaling: 1.5 }, timeoutSeconds },
    async (_ctx: TaskContext, runId: string, generation: number, correlation: string) =>
      stepOutcome(runId, generation, correlation, () => work(runId)))
}
export const questionOneTask = defineStep('questionOne', executeQuestionOne)
export const searchOneTask = defineStep('searchOne', executeSearchOne)
export const demoFaultTask = defineStep('demoFault', executeDemoFault, 30, 1)
export const gapTask = defineStep('gap', executeGap)
export const searchTwoTask = defineStep('searchTwo', executeSearchTwo)
export const guideTask = defineStep('guide', executeGuide, 180)
export const finishTask = defineStep('finish', finishRun, 30, 0)

export const researchWorkflow = task(
  { name: 'research', retry: { maxRetries: 1, waitDurationMs: 1000 }, timeoutSeconds: 600 },
  async (ctx: TaskContext, runId: string, generation: number, correlation: string) =>
    withContext({ requestId: correlation }, () => withExecution(runId, generation, async () => {
      try {
        // searchOne commits the first question and all its findings before the
        // optional fault is even considered. A retry must therefore reuse them.
        const steps = [questionOneTask, searchOneTask]
        if (await demoFaultEnabledForRun(runId)) steps.push(demoFaultTask)
        steps.push(gapTask, searchTwoTask, guideTask, finishTask)
        for (const step of steps) {
          const result = await ctx.run(step, runId, generation, correlation)
          if (result.kind !== 'done') return { ok: false, runId, outcome: result.kind }
        }
        return { ok: true, runId, outcome: 'done' }
      } catch (error) {
        logFailure('workflow.orchestrator', error)
        try { await markRunFailed(runId, error) } catch (secondary) { logFailure('workflow.failure_persist', secondary) }
        throw new Error('RESEARCH_WORKFLOW_FAILED')
      }
    })),
)
