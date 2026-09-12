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

console.log('2/3 · Reanudando con la búsqueda arreglada.')
process.env.LINKUP_API_KEY = goodKey
await advanceResearch(runId)

view = await readResearch(runId)
steps = stepMap(view)
assert.equal(view.status, 'done', `La ejecución no terminó: ${view.error ?? 'sin error'}`)
assert.equal(steps['question-1'].attempt, 1, 'El paso que ya había terminado no puede volver a ejecutarse.')
assert.equal(steps['search-1'].attempt, 2, 'El paso fallido debía reintentarse exactamente una vez.')
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

console.log('3/3 · Reanudando una ejecución ya terminada.')
await advanceResearch(runId)
const after = await readResearch(runId)
assert.equal(await countFindings(runId), findingsAfter, 'Reanudar duplicó hallazgos.')
assert.equal(after.questions.length, view.questions.length, 'Reanudar duplicó preguntas.')
assert.deepEqual(
  after.steps.map((s) => `${s.step}:${s.attempt}`),
  view.steps.map((s) => `${s.step}:${s.attempt}`),
  'Reanudar volvió a ejecutar pasos ya terminados.',
)

console.log(`\nOK · ejecución ${runId}`)
console.log('Fallo visible, recuperación sin repetir lo hecho, y ni un registro duplicado.')
process.exit(0)
