import { task, type TaskContext } from '@renderinc/sdk/workflows'
import {
  StepBusyError,
  executeQuestionOne,
  executeSearchOne,
  executeGap,
  executeSearchTwo,
  executeGuide,
  finishRun,
  markRunFailed,
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

/**
 * La comprobación final. No hace trabajo nuevo: relee la ejecución y decide si
 * de verdad hubo resultado. Sin reintentos, porque si los cinco pasos ya
 * terminaron y no hay evidencia, repetir esta lectura no la va a inventar.
 */
export const finishTask = task(
  {
    name: 'finish',
    retry: { maxRetries: 0, waitDurationMs: 1000 },
    timeoutSeconds: 30,
  },
  async (_ctx: TaskContext, runId: string) => {
    await finishRun(runId)
    return { runId }
  },
)

/**
 * El orquestador ya no puede cantar victoria por haber recorrido sus pasos.
 *
 * Antes devolvía `{ok:true}` en cuanto los cinco `ctx.run` resolvían. Una
 * corrida real del 12 de septiembre de 2026 se colgó 2 min 15 s —casi exacto
 * el tiempo máximo del primer paso—, no escribió una sola fila, y Render la
 * dio por completada con ese `{ok:true}` delante. Un paso que agota su tiempo
 * no es un paso completado.
 *
 * Y el fallo se escribe en la ejecución, no sólo en el paso: por esta vía los
 * pasos se llaman directamente, sin pasar por `advanceResearch`, así que nadie
 * dejaba constancia a nivel de ejecución y la fila se quedaba en `queued` para
 * siempre. Quien vuelve después tiene que encontrar el error, no un limbo.
 */
export const researchWorkflow = task(
  {
    name: 'research',
    retry: { maxRetries: 1, waitDurationMs: 1000 },
    timeoutSeconds: 600,
  },
  async (ctx: TaskContext, runId: string) => {
    try {
      await ctx.run(questionOneTask, runId)
      await ctx.run(searchOneTask, runId)
      await ctx.run(gapTask, runId)
      await ctx.run(searchTwoTask, runId)
      await ctx.run(guideTask, runId)
      await ctx.run(finishTask, runId)
    } catch (error) {
      // Que otro ejecutor tenga un paso no es un fallo: es la protección
      // funcionando, y el que lo tiene va a seguir la cadena.
      if (error instanceof StepBusyError) throw error
      await markRunFailed(runId, error instanceof Error ? error.message : 'Fallo sin detalle.')
      throw error
    }
    return { ok: true, runId }
  },
)
