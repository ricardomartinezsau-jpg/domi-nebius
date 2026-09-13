import { z } from 'zod'
import { query, queryOne } from './db.ts'
import { confidenceFrom, research, type Source } from './linkup.ts'
import { DEFAULT_MODEL, RESEARCH_MODEL, generateStructured } from './nebius.ts'
import { asEvidence, EVIDENCE_RULES, GAP_RULES, groundGuide, type StoredFinding } from './research-evidence.ts'

/**
 * Investigación en varios pasos, con estado en la base y recuperación.
 *
 * Tres propiedades gobiernan el diseño, y las tres son requisitos, no adornos:
 *
 * 1. **Cada paso se guarda antes de pasar al siguiente.** Si el proceso muere a
 *    la mitad —se cae el servidor, se recarga la página, se agota la red— lo
 *    hecho hasta ahí no se repite.
 * 2. **Reintentar es seguro.** La clave primaria (run_id, step) hace que el
 *    segundo intento encuentre el resultado del primero en vez de rehacerlo.
 *    No se cobra dos veces la misma búsqueda ni se duplican hallazgos.
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
export async function createResearchRun(input: ResearchInput): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO runs (anonymous, model, status, current_step, steps)
     VALUES (true, $1, 'queued', $2, $3::jsonb) RETURNING id`,
    [DEFAULT_MODEL, RESEARCH_STEPS[0], JSON.stringify([{ input }])],
  )
  if (!row) throw new Error('No se pudo crear la ejecución de investigación.')
  return row.id
}

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

/**
 * Cuánto vale el permiso para ejecutar un paso antes de que otro pueda
 * quitárselo. Existe porque un proceso que muere de golpe deja su paso en
 * 'running' para siempre, y sin caducidad nadie podría recuperarlo nunca.
 *
 * Más largo que el paso más lento (el de la guía, 180 s en Render) con margen:
 * el precio de equivocarse por corto es que dos ejecutores se pisen y se pague
 * dos veces la misma búsqueda.
 */
const STEP_LEASE_MS = 300_000

/** Se lanza cuando otro ejecutor tiene el paso en marcha ahora mismo. */
export class StepBusyError extends Error {
  constructor(step: string) {
    super(`El paso ${step} lo está ejecutando otro proceso.`)
    this.name = 'StepBusyError'
  }
}

/**
 * Ejecuta un paso una sola vez en la vida de la ejecución.
 *
 * Quién corre lo decide una sola escritura atómica: se reclama el paso si nadie
 * lo tiene, si el intento anterior falló, o si quien lo tenía lleva más de
 * STEP_LEASE_MS sin terminar (murió). Reclamar un paso que otro está
 * ejecutando ahora mismo NO está permitido, y esa es la diferencia: antes dos
 * ejecutores simultáneos —el de Render y el de reserva— podían pagar los dos
 * la misma búsqueda y duplicar los hallazgos.
 *
 * Un paso ya terminado devuelve su resultado sin llamar a nadie.
 */
async function runStep<T>(runId: string, step: ResearchStep, work: () => Promise<T>): Promise<T> {
  const existing = await queryOne<StepRow>('SELECT step, status, result, error, attempt FROM run_steps WHERE run_id = $1 AND step = $2', [runId, step])
  if (existing?.status === 'done') return existing.result as T

  const claimed = await queryOne<{ step: string }>(
    `INSERT INTO run_steps (run_id, step, status, attempt) VALUES ($1, $2, 'running', 1)
     ON CONFLICT (run_id, step) DO UPDATE SET status = 'running', attempt = run_steps.attempt + 1, error = NULL, started_at = now()
     WHERE run_steps.status = 'failed'
        OR (run_steps.status = 'running' AND run_steps.started_at < now() - ($3::int * interval '1 millisecond'))
     RETURNING step`,
    [runId, step, STEP_LEASE_MS],
  )
  if (!claimed) {
    const settled = await queryOne<StepRow>('SELECT status, result FROM run_steps WHERE run_id = $1 AND step = $2', [runId, step])
    // Terminó entre las dos consultas: su resultado sirve igual.
    if (settled?.status === 'done') return settled.result as T
    // Lo tiene otro y sigue vivo. Rendirse aquí es correcto: el que lo tiene
    // va a seguir la cadena. Fingir que salió bien devolvería undefined al
    // paso siguiente y el fallo aparecería más adelante, disfrazado.
    throw new StepBusyError(step)
  }

  await query('UPDATE runs SET status = $2, current_step = $3 WHERE id = $1', [runId, 'running', step])
  try {
    const result = await work()
    await query(
      `UPDATE run_steps SET status = 'done', result = $3::jsonb, finished_at = now() WHERE run_id = $1 AND step = $2`,
      [runId, step, JSON.stringify(result ?? null)],
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo sin detalle.'
    await query(`UPDATE run_steps SET status = 'failed', error = $3, finished_at = now() WHERE run_id = $1 AND step = $2`, [runId, step, message])
    throw error
  }
}

/**
 * Guarda pregunta y hallazgos de una vuelta.
 *
 * El índice único (run_id, round) es el cerrojo de abajo: si otro ejecutor ya
 * escribió esta vuelta, aquí no se inserta nada y se reusa lo suyo. Cuesta una
 * búsqueda pagada de más en ese caso raro, pero nunca hallazgos duplicados, que
 * es lo que la persona vería y lo que el premio prohíbe.
 */
async function saveFindings(runId: string, round: number, ask: { question: string; askedBecause: string }, answer: { answer: string; sources: Source[] }) {
  const question = await queryOne<{ id: string }>(
    `INSERT INTO research_questions (run_id, round, question, asked_because, status)
     VALUES ($1, $2, $3, $4, 'answered')
     ON CONFLICT (run_id, round) DO NOTHING
     RETURNING id`,
    [runId, round, ask.question, ask.askedBecause],
  )
  if (!question) {
    const existing = await queryOne<{ id: string; question: string }>(
      'SELECT id, question FROM research_questions WHERE run_id = $1 AND round = $2',
      [runId, round],
    )
    if (!existing) throw new Error('No se pudo guardar la pregunta de investigación.')
    const already = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM findings WHERE question_id = $1', [existing.id])
    return { questionId: existing.id, sources: already?.n ?? 0, confidence: 'single' as const, reused: true }
  }

  const confidence = confidenceFrom(answer.sources)
  for (const source of answer.sources.slice(0, 8)) {
    await query(
      `INSERT INTO findings (question_id, run_id, claim, source_url, source_name, snippet, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [question.id, runId, answer.answer, source.url, source.name, source.snippet ?? null, confidence],
    )
  }
  return { questionId: question.id, sources: answer.sources.length, confidence }
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
  return runStep(runId, 'search-1', async () => {
    const answer = await research(first.result.question)
    return saveFindings(runId, 1, first.result, answer)
  })
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
    return runStep(runId, 'search-2', async () => {
      const answer = await research(gap.question)
      return saveFindings(runId, 2, { question: gap.question, askedBecause: gap.askedBecause }, answer)
    })
  } else {
    await query(
      `INSERT INTO run_steps (run_id, step, status, result, finished_at) VALUES ($1, 'search-2', 'done', $2::jsonb, now())
       ON CONFLICT (run_id, step) DO NOTHING`,
      [runId, JSON.stringify({ skipped: true, reason: gap.disagreement || 'Los hallazgos de la primera vuelta ya cubren la tarea.' })],
    )
    return { skipped: true }
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

    return groundGuide(output, stored, gap?.disagreement || null) satisfies Guide & { disagreement: string | null }
  })

  // Aquí NO se declara terminada la ejecución. Este paso puede devolver una
  // guía con cero pasos —si ningún paso citó una fuente recuperable, el filtro
  // de arriba los quita todos— y antes eso bastaba para marcarla completada.
  // Quien declara el final es `finishRun`, y sólo con evidencia delante.
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
  const row = await queryOne<{ findings: string; sources: string; steps: string }>(
    `SELECT
       (SELECT count(*) FROM findings WHERE run_id = $1) AS findings,
       (SELECT count(DISTINCT source_url) FROM findings WHERE run_id = $1) AS sources,
       coalesce((SELECT jsonb_array_length(coalesce(result -> 'steps', '[]'::jsonb))
                 FROM run_steps WHERE run_id = $1 AND step = 'guide' AND status = 'done'), 0) AS steps`,
    [runId],
  )
  const missing = missingEvidence({ findings: Number(row?.findings ?? 0), sources: Number(row?.sources ?? 0), steps: Number(row?.steps ?? 0) })
  if (missing.length) throw new Error(`La investigación no produjo ${missing.join(', ')}. No se declara completada.`)
  // El error de un intento anterior se borra al terminar bien: una ejecución
  // que se recuperó no puede seguir mostrando el fallo del que se recuperó.
  await query(`UPDATE runs SET status = 'done', current_step = NULL, ok = true, error = NULL WHERE id = $1`, [runId])
}

/** Deja el fallo escrito en la ejecución, no sólo en el paso que lo provocó. */
export async function markRunFailed(runId: string, message: string): Promise<void> {
  await query(`UPDATE runs SET status = 'failed', ok = false, error = $2 WHERE id = $1`, [runId, message])
}

/**
 * Avanza la ejecución hasta terminarla. Es reanudable: llamarla otra vez
 * después de un fallo retoma en el primer paso que no esté terminado.
 */
export async function advanceResearch(runId: string): Promise<void> {
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
    if (error instanceof StepBusyError) return
    await markRunFailed(runId, error instanceof Error ? error.message : 'Fallo sin detalle.')
    throw error
  }
}

export type ResearchView = {
  runId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  currentStep: string | null
  error: string | null
  steps: { step: string; status: string; attempt: number; error: string | null }[]
  questions: { round: number; question: string; askedBecause: string }[]
  sources: { url: string; name: string | null; confidence: string; round: number }[]
  guide: (Guide & { disagreement: string | null }) | null
}

/** Todo lo que se puede recuperar de una ejecución, con o sin la pestaña abierta. */
export async function readResearch(runId: string): Promise<ResearchView | null> {
  const run = await queryOne<{ id: string; status: ResearchView['status']; current_step: string | null; error: string | null }>(
    'SELECT id, status, current_step, error FROM runs WHERE id = $1',
    [runId],
  )
  if (!run) return null

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
    steps,
    questions: questions.map((row) => ({ round: row.round, question: row.question, askedBecause: row.asked_because })),
    sources: sources.map((row) => ({ url: row.source_url, name: row.source_name, confidence: row.confidence, round: row.round })),
    guide: guideRow?.result ?? null,
  }
}
