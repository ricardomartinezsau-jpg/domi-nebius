/**
 * Prueba de extremo a extremo de la investigación: fallo, recuperación y
 * ausencia de efectos duplicados.
 *
 * No corre sola. Gasta búsquedas de Linkup y llamadas a Nebius de verdad, y
 * escribe en la base de datos real, así que hay que pedirla:
 *
 *   node tests/research.e2e.mjs --run
 *
 * Comprueba las tres cosas que el proceso promete:
 *   1. Un paso que falla queda registrado y visible, y la ejecución no miente
 *      diciendo que terminó.
 *   2. Al reanudar, el paso que sí había terminado no se vuelve a ejecutar.
 *   3. Reanudar una ejecución ya terminada no crea ni un hallazgo más.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const file of ['.env.local', '.env']) {
  const full = path.join(ROOT, file)
  if (!fs.existsSync(full)) continue
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

if (!process.argv.includes('--run')) {
  console.log('Esta prueba consume Linkup, Nebius y la base real. Ejecuta: node tests/research.e2e.mjs --run')
  process.exit(0)
}

for (const required of ['DATABASE_URL', 'NEBIUS_API_KEY', 'LINKUP_API_KEY']) {
  if (!process.env[required]?.trim()) {
    console.error(`Falta ${required} en .env.local.`)
    process.exit(1)
  }
}

const { advanceResearch, createResearchRun, readResearch } = await import('../lib/research.ts')
const { query } = await import('../lib/db.ts')

const INPUT = {
  taskTitle: 'Publicar mi portafolio como sitio estático',
  blocker: 'No sé qué configuración pide el servicio para que el sitio quede publicado.',
  locale: 'es',
}

const countFindings = async (runId) =>
  Number((await query('SELECT count(*)::int AS n FROM findings WHERE run_id = $1', [runId]))[0].n)

const stepMap = (view) => Object.fromEntries(view.steps.map((s) => [s.step, s]))

console.log('1/3 · Primera vuelta con la búsqueda rota a propósito.')
const runId = await createResearchRun(INPUT)
const goodKey = process.env.LINKUP_API_KEY
process.env.LINKUP_API_KEY = 'clave-invalida-para-la-prueba'

await assert.rejects(() => advanceResearch(runId), 'La ejecución debía fallar con la clave rota.')

let view = await readResearch(runId)
let steps = stepMap(view)
assert.equal(view.status, 'failed', 'Una ejecución rota no puede reportarse como terminada.')
assert.equal(steps['question-1'].status, 'done')
assert.equal(steps['search-1'].status, 'failed')
assert.ok(steps['search-1'].error, 'El error del paso tiene que quedar visible.')
assert.equal(await countFindings(runId), 0)
console.log(`    Estado ${view.status} · paso fallido: search-1 (${steps['search-1'].error})`)

/**
 * Reintenta como reintentaría Render: cada tarea del workflow está declarada
 * con maxRetries 3, así que una prueba que llama una sola vez no ejercita el
 * sistema que se despliega, sino uno más frágil. Devuelve cuántas pasadas
 * hicieron falta, que es un dato en sí: Nebius falla de forma intermitente y
 * conviene saber con qué frecuencia.
 */
async function advanceUntilDone(id, maxPasses = 4) {
  for (let pass = 1; pass <= maxPasses; pass++) {
    try {
      await advanceResearch(id)
    } catch {
      // El fallo ya quedó escrito en la base; la siguiente pasada retoma.
    }
    const state = await readResearch(id)
    if (state.status === 'done') return pass
  }
  return maxPasses
}

console.log('2/3 · Reanudando con la búsqueda arreglada.')
process.env.LINKUP_API_KEY = goodKey
const passes = await advanceUntilDone(runId)
console.log(`    pasadas necesarias: ${passes}`)

view = await readResearch(runId)
steps = stepMap(view)
assert.equal(view.status, 'done', `La ejecución no terminó: ${view.error ?? 'sin error'}`)
assert.equal(steps['question-1'].attempt, 1, 'El paso que ya había terminado no puede volver a ejecutarse.')
assert.ok(steps['search-1'].attempt >= 2, 'El paso fallido debía reintentarse.')
assert.ok(view.guide, 'Falta la guía final.')
assert.ok(view.guide.steps.length > 0, 'La guía quedó sin pasos respaldados.')
for (const step of view.guide.steps) {
  assert.ok(step.sourceUrls.length > 0, `El paso "${step.title}" llegó sin fuente.`)
  for (const url of step.sourceUrls) {
    assert.ok(view.sources.some((source) => source.url === url), `El paso "${step.title}" cita una URL que no se recuperó.`)
  }
}

const findingsAfter = await countFindings(runId)
const rounds = [...new Set(view.questions.map((q) => q.round))]
console.log(`    Terminó · ${view.questions.length} pregunta(s) en ${rounds.length} vuelta(s) · ${findingsAfter} hallazgos · ${view.guide.steps.length} pasos con fuente · ${view.guide.unconfirmed.length} sin confirmar`)
for (const question of view.questions) console.log(`    vuelta ${question.round}: ${question.question}`)

console.log('3/4 · Reanudando una ejecución ya terminada.')
await advanceResearch(runId)
const after = await readResearch(runId)
assert.equal(await countFindings(runId), findingsAfter, 'Reanudar duplicó hallazgos.')
assert.equal(after.questions.length, view.questions.length, 'Reanudar duplicó preguntas.')
assert.deepEqual(
  after.steps.map((s) => `${s.step}:${s.attempt}`),
  view.steps.map((s) => `${s.step}:${s.attempt}`),
  'Reanudar volvió a ejecutar pasos ya terminados.',
)

/**
 * El caso que de verdad amenaza el dinero: Render arrancó la tarea y la
 * aplicación, creyendo que no, arrancó la suya. Dos ejecutores sobre la misma
 * investigación, a la vez. Reintentar en fila india ya se probaba arriba; esto
 * es lo otro, y es lo que duplica búsquedas pagadas y hallazgos en pantalla.
 */
console.log('4/4 · Dos ejecutores simultáneos sobre la misma investigación.')
const raceId = await createResearchRun(INPUT)
const outcomes = await Promise.allSettled([advanceResearch(raceId), advanceResearch(raceId)])
await advanceUntilDone(raceId)
console.log(`    resultados: ${outcomes.map((o) => o.status === 'fulfilled' ? 'ok' : o.reason?.name ?? 'error').join(' · ')}`)

const raced = await readResearch(raceId)
assert.equal(raced.status, 'done', `La carrera no terminó bien: ${raced.error ?? 'sin error'}`)

const racedRounds = raced.questions.map((q) => q.round)
assert.deepEqual([...new Set(racedRounds)], racedRounds, 'Se guardó dos veces la misma vuelta de investigación.')

const perQuestion = await query(
  `SELECT q.round, count(f.id)::int AS n, count(DISTINCT f.source_url)::int AS distintas
   FROM research_questions q LEFT JOIN findings f ON f.question_id = q.id
   WHERE q.run_id = $1 GROUP BY q.round ORDER BY q.round`,
  [raceId],
)
for (const row of perQuestion) {
  assert.equal(row.n, row.distintas, `La vuelta ${row.round} guardó ${row.n} hallazgos con solo ${row.distintas} fuentes distintas: hay duplicados.`)
}
assert.ok(raced.guide, 'La carrera terminó sin guía.')
console.log(`    ${raced.questions.length} vuelta(s), sin duplicados · ${perQuestion.map((r) => `vuelta ${r.round}: ${r.n}`).join(' · ')}`)

console.log(`\nOK · ejecuciones ${runId} y ${raceId}`)
console.log('Fallo visible, recuperación sin repetir lo hecho, dos ejecutores a la vez, y ni un registro duplicado.')
process.exit(0)
