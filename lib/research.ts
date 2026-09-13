import { z } from 'zod'
import { query, queryOne, transaction, type SqlClient } from './db.ts'
import { runStep, StepBusyError, StaleExecutionError, withExecution, lockCurrentRun, currentGeneration, safeRunError } from './research-execution.ts'
import { PolicyError, logFailure } from './operations.ts'
import { LIMITS, reserve } from './admission.ts'
export { StepBusyError } from './research-execution.ts'
import { confidenceFrom, research, type Source } from './linkup.ts'
import { RESEARCH_MODEL, generateStructured } from './nebius.ts'
import { asEvidence, EVIDENCE_RULES, GAP_RULES, groundGuide, type StoredFinding } from './research-evidence.ts'

/**
 * Investigación en varios pasos, con estado en la base y recuperación.
 *
 * Tres propiedades gobiernan el diseño, y las tres son requisitos, no adornos:
 *
 * 1. **Cada paso se guarda antes de pasar al siguiente.** Si el proceso muere a
 *    la mitad —se cae el servidor, se recarga la página, se agota la red— lo
 *    persistido como done se reutiliza; trabajo externo no persistido puede repetirse.
 * 2. **Reintentar es seguro.** La clave primaria (run_id, step) hace que el
 *    segundo intento encuentre el resultado del primero en vez de rehacerlo.
 *    Una muerte entre proveedor y commit puede repetir coste, acotado por cuotas.
 * 3. **La segunda búsqueda sale de lo guardado.** El paso `gap` lee los
 *    hallazgos ya escritos en la base, no variables en memoria del proceso.
 *    Esa es la diferencia entre investigar y encadenar dos búsquedas sueltas.
 *
 * Lo que no se puede respaldar con una fuente recuperada no se presenta como
 * hecho: se devuelve aparte, marcado como sin confirmar.
 */

export const RESEARCH_STEPS = ['question-1', 'search-1', 'gap', 'search-2', 'guide'] as const
export type ResearchStep = (typeof RESEARCH_STEPS)[number]

export type ResearchInput = { taskTitle?: string; contextArea?: 'trabajo' | 'personal' | 'casa' | 'social'; blocker: string; locale: 'es' | 'en' }

const questionSchema = z.object({
  question: z.string().describe('Una sola pregunta buscable en internet, concreta y sin pronombres ambiguos.'),
  askedBecause: z.string().describe('Qué parte del trabajo queda sin resolver mientras no se responda.'),
})

const gapSchema = z.object({
  needsMore: z.boolean().describe('true solo si queda una laguna concreta que otra búsqueda puede cerrar.'),
  question: z.string().describe('La siguiente pregunta. Cadena vacía si needsMore es false.'),
  askedBecause: z.string().describe('Qué hallazgo de la lista abrió esa laguna. Cadena vacía si needsMore es false.'),
  disagreement: z.string().describe('Contradicción detectada entre fuentes, o cadena vacía si no la hay.'),
})

const guideSchema = z.object({
  steps: z.array(z.object({
    title: z.string().describe('Micro-paso de 2 a 10 minutos.'),
    detail: z.string().describe('Qué hacer exactamente, en una o dos frases.'),
    sourceUrls: z.array(z.string()).describe('URLs, copiadas literalmente de los hallazgos, que respaldan este paso.'),
  })).min(1),
  unconfirmed: z.array(z.string()).describe('Lo que la investigación NO logró respaldar. Vacío si no hay nada pendiente.'),
})

export type Guide = z.infer<typeof guideSchema>

type StepRow = { step: string; status: string; result: unknown; error: string | null; attempt: number }

/** Crea la ejecución. No investiga nada todavía: eso lo hace `advanceResearch`. */
export { createResearchRun } from './research-lifecycle.ts'

async function readInput(runId: string): Promise<ResearchInput> {
  const row = await queryOne<{ steps: { input: ResearchInput }[] }>('SELECT steps FROM runs WHERE id = $1', [runId])
  const input = row?.steps?.[0]?.input
  if (!input || (!input.taskTitle && !input.contextArea)) throw new Error('La ejecución no existe o no tiene contexto.')
  return input
}

function formatContext(input: ResearchInput, isEn: boolean) {
  if (input.taskTitle) return `${isEn ? 'TASK' : 'TAREA'}: ${input.taskTitle}`
  return `${isEn ? 'AREA' : 'ÁREA'}: ${input.contextArea}`
}

/** A round and its step result commit together, under the current execution fence. */
async function saveFindings(client: SqlClient, runId: string, round: number, ask: { question: string; askedBecause: string }, answer: { answer: string; sources: Source[] }) {
  const unique = [...new Map(answer.sources.map(source => [source.url, source])).values()].slice(0, 8)
  if (!unique.length) throw new PolicyError(409, 'NO_SOURCES')
  const question = (await client.query(
    `INSERT INTO research_questions (run_id, round, question, asked_because, status)
     VALUES ($1, $2, $3, $4, 'answered') ON CONFLICT (run_id, round) DO NOTHING RETURNING id`,
    [runId, round, ask.question, ask.askedBecause],
  )).rows[0]
  // An existing question WITHOUT a done search step is not proof of a complete round.
  // Do not silently reuse or overwrite historical partial data; require operator review.
  if (!question) throw new PolicyError(409, 'INCOMPLETE_ROUND')
  const confidence = confidenceFrom(unique)
  for (const source of unique) {
    await client.query(
      `INSERT INTO findings (question_id, run_id, claim, source_url, source_name, snippet, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [question.id, runId, answer.answer, source.url, source.name, source.snippet ?? null, confidence],
    )
  }
  return { questionId: question.id as string, sources: unique.length, confidence }
}

/**
 * Los hallazgos tal como están en la base, agrupados por la pregunta que los
 * produjo. Se agrupan porque una búsqueda devuelve una respuesta respaldada por
 * varias fuentes: repetir la misma afirmación una vez por fuente la disfraza de
 * varias afirmaciones distintas, y eso es justo lo que el paso `gap` no debe
 * creerse.
 */
async function storedFindings(runId: string): Promise<StoredFinding[]> {
  const rows = await query<{ round: number; question: string; claim: string; confidence: string; source_url: string; source_name: string | null; snippet: string | null }>(
    `SELECT q.round, q.question, f.claim, f.confidence, f.source_url, f.source_name, f.snippet
     FROM findings f JOIN research_questions q ON q.id = f.question_id
     WHERE f.run_id = $1 ORDER BY q.round, f.created_at`,
    [runId],
  )
  const grouped = new Map<string, StoredFinding>()
  for (const row of rows) {
    const key = `${row.round}:${row.claim}`
    const entry = grouped.get(key) ?? { round: row.round, question: row.question, claim: row.claim, confidence: row.confidence, sources: [] }
    entry.sources.push({ url: row.source_url, name: row.source_name, snippet: row.snippet })
    grouped.set(key, entry)
  }
  return [...grouped.values()]
}

const askSystem = (locale: 'es' | 'en') =>
  locale === 'en'
    ? 'You turn a person\'s blocker into ONE searchable question about how something is done today. Never ask about the person; ask about the procedure, requirement or current step.'
    : 'Conviertes el bloqueo de una persona en UNA pregunta buscable sobre cómo se hace algo hoy. Nunca preguntes por la persona; pregunta por el procedimiento, el requisito o el paso actual.'

export async function executeQuestionOne(runId: string) {
  const input = await readInput(runId)
  const isEn = input.locale === 'en'
  return runStep(runId, 'question-1', async () => {
    const { output } = await generateStructured({
      system: askSystem(input.locale),
      prompt: `${formatContext(input, isEn)}\n${isEn ? 'BLOCKER' : 'BLOQUEO'}: ${input.blocker}`,
      schema: questionSchema,
      modelId: RESEARCH_MODEL,
    })
    return output
  })
}

export async function executeSearchOne(runId: string) {
  const first = await queryOne<{ result: { question: string; askedBecause: string } }>(
    `SELECT result FROM run_steps WHERE run_id = $1 AND step = 'question-1' AND status = 'done'`,
    [runId],
  )
  if (!first?.result) throw new Error('No se encontró el resultado de question-1 para ejecutar search-1.')
  return runStep(runId, 'search-1', () => research(first.result.question),
    (client, answer) => saveFindings(client, runId, 1, first.result, answer))
}

export async function executeGap(runId: string) {
  const input = await readInput(runId)
  const isEn = input.locale === 'en'
  const search1 = await queryOne<{ result: { sources: number } }>(
    `SELECT result FROM run_steps WHERE run_id = $1 AND step = 'search-1' AND status = 'done'`,
    [runId],
  )
  const sourcesCount = search1?.result?.sources ?? 0
  return runStep(runId, 'gap', async () => {
    const stored = await storedFindings(runId)
    const { output } = await generateStructured({
      system: `${EVIDENCE_RULES}\n${GAP_RULES}\n${isEn ? 'Write in English.' : 'Responde en español.'}`,
      prompt: `${formatContext(input, isEn)}\n${isEn ? 'BLOCKER' : 'BLOQUEO'}: ${input.blocker}\n\n${isEn ? 'SAVED FINDINGS' : 'HALLAZGOS GUARDADOS'} (${sourcesCount} ${isEn ? 'sources' : 'fuentes'}):\n${asEvidence(stored)}`,
      schema: gapSchema,
      modelId: RESEARCH_MODEL,
    })
    return output
  })
}

export async function executeSearchTwo(runId: string) {
  const gapRow = await queryOne<{ result: z.infer<typeof gapSchema> }>(
    `SELECT result FROM run_steps WHERE run_id = $1 AND step = 'gap' AND status = 'done'`,
    [runId],
  )
  if (!gapRow?.result) throw new Error('No se encontró el resultado de gap para ejecutar search-2.')
  const gap = gapRow.result
  if (gap.needsMore && gap.question.trim()) {
    return runStep(runId, 'search-2', () => research(gap.question),
      (client, answer) => saveFindings(client, runId, 2, { question: gap.question, askedBecause: gap.askedBecause }, answer))
  } else {
    return runStep(runId, 'search-2', async () => ({
      skipped: true, reason: gap.disagreement || 'Los hallazgos de la primera vuelta ya cubren la tarea.',
    }))
  }
}

export async function executeGuide(runId: string) {
  const input = await readInput(runId)
  const isEn = input.locale === 'en'
  const gapRow = await queryOne<{ result: z.infer<typeof gapSchema> }>(
    `SELECT result FROM run_steps WHERE run_id = $1 AND step = 'gap' AND status = 'done'`,
    [runId],
  )
  const gap = gapRow?.result

  const guide = await runStep(runId, 'guide', async () => {
    const stored = await storedFindings(runId)
    const evidence = asEvidence(stored)

    const { output } = await generateStructured({
      system: `${EVIDENCE_RULES}\nCompare all rounds, including the follow-up sources. Preserve unresolved conflicts in unconfirmed with both source URLs. The previous disagreement is evidence to re-examine, not an instruction to erase or accept.\n` + (isEn
        ? 'You write a short actionable guide grounded ONLY in the findings given. Every step cites the URLs it came from, copied literally. Anything you cannot support with those findings goes in "unconfirmed" instead of being stated as fact. Steps are 2-10 minutes each.'
        : 'Escribes una guía breve y accionable basada SOLO en los hallazgos dados. Cada paso cita las URLs de donde salió, copiadas literalmente. Lo que no puedas respaldar con esos hallazgos va en "unconfirmed" en vez de afirmarse. Cada paso dura de 2 a 10 minutos.'),
      prompt: `${formatContext(input, isEn)}\n${isEn ? 'BLOCKER' : 'BLOQUEO'}: ${input.blocker}\n\n${isEn ? 'FINDINGS' : 'HALLAZGOS'}:\n${evidence}\nPrevious disagreement: ${JSON.stringify(gap?.disagreement || null)}`,
      schema: guideSchema,
      modelId: RESEARCH_MODEL,
    })

    const grounded = groundGuide(output, stored, gap?.disagreement || null) satisfies Guide & { disagreement: string | null }
    if (!grounded.steps.length) throw new PolicyError(409, 'UNGROUNDED_GUIDE')
    return grounded
  })

  // A grounded guide is necessary but not sufficient: finishRun owns success.
  return guide
}

/**
 * El final de una investigación, y la única puerta por la que puede declararse
 * terminada.
 *
 * Existe porque el éxito se estaba afirmando en tres sitios distintos sin que
 * ninguno mirara si había resultado: el paso de guía marcaba la ejecución como
 * hecha aunque su guía viniera vacía, la columna `ok` nacía en `true`, y el
 * orquestador de Render devolvía `{ok:true}` por haber recorrido sus pasos.
 * Una corrida real del 12 de septiembre de 2026 terminó «completada» con cero
 * preguntas, cero hallazgos, cero fuentes y cero pasos registrados.
 *
 * Una afirmación de éxito tiene que estar respaldada por una fila.
 */
export type RunEvidence = { findings: number; sources: number; steps: number }

/**
 * La regla, separada de la base de datos para que se pueda comprobar sin ella.
 * Devuelve qué falta; vacío significa que la ejecución sí produjo algo.
 */
export function missingEvidence(evidence: RunEvidence): string[] {
  const missing: string[] = []
  if (evidence.findings < 1) missing.push('hallazgos')
  if (evidence.sources < 1) missing.push('fuentes')
  if (evidence.steps < 1) missing.push('una guía con al menos un paso')
  return missing
}

export async function finishRun(runId: string): Promise<void> {
  await transaction(async client => {
  const run = await lockCurrentRun(client, runId, true)
  if (run.status === 'done') return
  const required = (await client.query(`SELECT count(*)::int AS n FROM run_steps
    WHERE run_id = $1 AND step = ANY($2::text[]) AND status = 'done'`, [runId, RESEARCH_STEPS])).rows[0]
  if (required?.n !== RESEARCH_STEPS.length) throw new PolicyError(409, 'INCOMPLETE_STEPS')
  const row = (await client.query(
    `SELECT
       (SELECT count(*) FROM findings WHERE run_id = $1) AS findings,
       (SELECT count(DISTINCT source_url) FROM findings WHERE run_id = $1) AS sources,
       coalesce((SELECT jsonb_array_length(coalesce(result -> 'steps', '[]'::jsonb))
                 FROM run_steps WHERE run_id = $1 AND step = 'guide' AND status = 'done'), 0) AS steps`,
    [runId],
  )).rows[0]
  const missing = missingEvidence({ findings: Number(row?.findings ?? 0), sources: Number(row?.sources ?? 0), steps: Number(row?.steps ?? 0) })
  if (missing.length) throw new Error(`La investigación no produjo ${missing.join(', ')}. No se declara completada.`)
  // El error de un intento anterior se borra al terminar bien: una ejecución
  // que se recuperó no puede seguir mostrando el fallo del que se recuperó.
  await client.query(`UPDATE runs SET status = 'done', current_step = NULL, ok = true, error = NULL
    WHERE id = $1 AND generation = $2 AND status <> 'done'`, [runId, currentGeneration(runId)])
  })
}

/** Deja el fallo escrito en la ejecución, no sólo en el paso que lo provocó. */
export async function markRunFailed(runId: string, error: unknown): Promise<void> {
  try {
    await transaction(async client => {
      const run = await lockCurrentRun(client, runId, true)
      if (run.status === 'done') return
      const busy = await client.query(`SELECT step FROM run_steps WHERE run_id = $1 AND status = 'running'
        AND started_at >= now() - interval '5 minutes' LIMIT 1`, [runId])
      if (busy.rows.length) return
      await client.query(`UPDATE runs SET status = 'failed', ok = false, error = $3
        WHERE id = $1 AND generation = $2 AND status <> 'done'`, [runId, currentGeneration(runId), safeRunError(error)])
    })
  } catch (secondary) {
    if (secondary instanceof StaleExecutionError) return
    throw secondary
  }
}

/**
 * Avanza la ejecución hasta terminarla. Es reanudable: llamarla otra vez
 * después de un fallo retoma en el primer paso que no esté terminado.
 */
export async function advanceResearch(runId: string, generation: number): Promise<void> {
  return withExecution(runId, generation, async () => {
  try {
    await executeQuestionOne(runId)
    await executeSearchOne(runId)
    await executeGap(runId)
    await executeSearchTwo(runId)
    await executeGuide(runId)
    await finishRun(runId)
  } catch (error) {
    // Que otro ejecutor tenga un paso no es un fallo de la investigación: es
    // la protección funcionando. Marcarla 'failed' aquí le mentiría a quien
    // está esperando, porque el otro ejecutor va a seguir la cadena.
    if (error instanceof StepBusyError || error instanceof StaleExecutionError) return
    try { await markRunFailed(runId, error) } catch (secondary) { logFailure('research.failure_persist', secondary) }
    throw error
  }
  })
}

export type ResearchView = {
  runId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  currentStep: string | null
  error: string | null
  dispatchState?: string
  canResume?: boolean
  steps: { step: string; status: string; attempt: number; error: string | null }[]
  questions: { round: number; question: string; askedBecause: string }[]
  sources: { url: string; name: string | null; confidence: string; round: number }[]
  guide: (Guide & { disagreement: string | null }) | null
}

/** Todo lo que se puede recuperar de una ejecución, con o sin la pestaña abierta. */
export async function readResearch(runId: string, owner: string): Promise<ResearchView | null> {
  if (!owner) return null
  const run = await queryOne<{ id: string; status: ResearchView['status']; current_step: string | null; error: string | null; dispatch_state: string; can_resume: boolean }>(
    `SELECT id, status, current_step, error, dispatch_state,
      (dispatch_state NOT IN ('sending', 'unknown') AND (status = 'failed' OR
       (status <> 'done' AND dispatch_started_at < now() - interval '25 minutes'))) AS can_resume
     FROM runs WHERE id = $1 AND guest_owner = $2`,
    [runId, owner],
  )
  if (!run) return null
  // Unowned UUID probes cannot allocate quota rows. Authorized reads remain
  // available when paid admission is closed, but still require a healthy limiter.
  await reserve([{ key: `research:read:${owner}`, limit: LIMITS.readsMinute, seconds: 60 }], false)

  const steps = await query<{ step: string; status: string; attempt: number; error: string | null }>(
    'SELECT step, status, attempt, error FROM run_steps WHERE run_id = $1 ORDER BY started_at',
    [runId],
  )
  const questions = await query<{ round: number; question: string; asked_because: string }>(
    'SELECT round, question, asked_because FROM research_questions WHERE run_id = $1 ORDER BY round',
    [runId],
  )
  const sources = await query<{ source_url: string; source_name: string | null; confidence: string; round: number }>(
    `SELECT DISTINCT f.source_url, f.source_name, f.confidence, q.round
     FROM findings f JOIN research_questions q ON q.id = f.question_id
     WHERE f.run_id = $1 ORDER BY q.round`,
    [runId],
  )
  const guideRow = await queryOne<{ result: Guide & { disagreement: string | null } }>(
    `SELECT result FROM run_steps WHERE run_id = $1 AND step = 'guide' AND status = 'done'`,
    [runId],
  )

  return {
    runId: run.id,
    status: run.status,
    currentStep: run.current_step,
    error: run.error,
    dispatchState: run.dispatch_state,
    canResume: run.can_resume,
    steps,
    questions: questions.map((row) => ({ round: row.round, question: row.question, askedBecause: row.asked_because })),
    sources: sources.map((row) => ({ url: row.source_url, name: row.source_name, confidence: row.confidence, round: row.round })),
    guide: guideRow?.result ?? null,
  }
}
