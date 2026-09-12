import { task, type TaskContext } from '@renderinc/sdk/workflows'
import {
  executeQuestionOne,
  executeSearchOne,
  executeGap,
  executeSearchTwo,
  executeGuide,
} from './research.ts'

/**
 * Tareas de Render Workflows para la investigación en segundo plano.
 *
 * Cada paso corre en su propio compute aislado gestionado por Render, permitiendo
 * reintentos granulares por paso. La idempotencia y la protección contra efectos
 * duplicados (búsquedas repetidas o hallazgos dobles) están respaldadas por la
 * clave primaria (run_id, step) en PostgreSQL.
 */

export const questionOneTask = task(
  {
    name: 'questionOne',
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
    timeoutSeconds: 120,
  },
  async (_ctx: TaskContext, runId: string) => {
    return executeQuestionOne(runId)
  },
)

export const searchOneTask = task(
  {
    name: 'searchOne',
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
    timeoutSeconds: 120,
  },
  async (_ctx: TaskContext, runId: string) => {
    return executeSearchOne(runId)
  },
)

export const gapTask = task(
  {
    name: 'gap',
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
    timeoutSeconds: 120,
  },
  async (_ctx: TaskContext, runId: string) => {
    return executeGap(runId)
  },
)

export const searchTwoTask = task(
  {
    name: 'searchTwo',
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
    timeoutSeconds: 120,
  },
  async (_ctx: TaskContext, runId: string) => {
    return executeSearchTwo(runId)
  },
)

export const guideTask = task(
  {
    name: 'guide',
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
    timeoutSeconds: 180,
  },
  async (_ctx: TaskContext, runId: string) => {
    return executeGuide(runId)
  },
)

export const researchWorkflow = task(
  {
    name: 'research',
    retry: { maxRetries: 1, waitDurationMs: 1000 },
    timeoutSeconds: 600,
  },
  async (ctx: TaskContext, runId: string) => {
    await ctx.run(questionOneTask, runId)
    await ctx.run(searchOneTask, runId)
    await ctx.run(gapTask, runId)
    await ctx.run(searchTwoTask, runId)
    await ctx.run(guideTask, runId)
    return { ok: true, runId }
  },
)
