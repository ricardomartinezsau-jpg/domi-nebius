/**
 * Evaluación reproducible del triage de Domi sobre Nebius Token Factory.
 *
 * Sin red en --dry-run y --self-test. El modo real exige NEBIUS_API_KEY en
 * este proceso (no se leen archivos .env implícitamente).
 *
 * Mide el flujo REAL del producto, que son dos llamadas: la rápida (bandejas y
 * arranque, lo que la persona ve primero) y la de detalle (dependencias y
 * micro-pasos). Medir una sola llamada gorda daría un número que ningún
 * usuario experimenta.
 *
 * Reutiliza el prompt y los esquemas reales de lib/triage.ts transpilándolo en
 * una sandbox que sustituye lib/nebius.ts por una función que solo captura
 * {system, prompt, schema}: se arma la solicitud exacta sin llamar a nadie.
 * @ts-check
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { z } from 'zod'
import { Output } from 'ai'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES_PATH = path.join(ROOT, 'tests/fixtures.json')
const TRIAGE_PATH = path.join(ROOT, 'lib/triage.ts')
const REPORT_PATH = path.join(ROOT, 'EVALUATION.md')
const EVIDENCE_DIR = path.join(ROOT, 'evaluation-evidence')
const BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
// Solo laboratorios occidentales. Identificadores confirmados con `npm run models`.
const CANDIDATE_MODELS = [
  'google/gemma-3-27b-it',
  'meta-llama/Llama-3.3-70B-Instruct',
  'openai/gpt-oss-120b',
  'nvidia/nemotron-3-super-120b-a12b',
]
let MODEL = process.env.NEBIUS_MODEL?.trim() || CANDIDATE_MODELS[0]
const MAX_OUTPUT_TOKENS = 4096
const TIMEOUT_MS = 60_000
const TEMPERATURE = 0.2
// Precios de referencia NO verificados contra la tarifa vigente.
const REFERENCE_PRICING = { promptPerMillionUsd: 0.13, completionPerMillionUsd: 0.4, verified: false }
// La fase rápida es la que la persona espera mirando la pantalla.
const TARGETS = { quickLatencyMs: 5000, totalLatencyMs: 20000, averageEstimatedCostUsd: 0.002 }

const fixtureSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    rawDump: z.string().min(1),
    expected: z
      .object({
        traysPopulated: z
          .array(z.enum(['personalBienestar', 'profesionalProductiva', 'familiarDomestica', 'socialComunitaria']))
          .optional(),
        identifiedCaveTrap: z.boolean().optional(),
        orderedSequence: z.boolean().optional(),
        firstActionIsPrerequisite: z.boolean().optional(),
        microTasksGenerated: z.boolean().optional(),
        maxMicroTaskMinutes: z.number().optional(),
        hasPhysicalHook: z.boolean().optional(),
        notes: z.string().optional(),
      })
      .strict(),
  })
  .strict()

function loadTriageContract() {
  const source = fs.readFileSync(TRIAGE_PATH, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: TRIAGE_PATH,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  if (compiled.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)) {
    throw new Error('No se pudo transpilar lib/triage.ts. Ejecuta npm run typecheck primero.')
  }
  const module = { exports: {} }
  function restrictedRequire(id) {
    if (id === 'zod') return { z }
    if (id === './nebius') return { generateStructured: async (args) => args }
    throw new Error(`Import no permitido en el evaluador: ${id}`)
  }
  vm.runInNewContext(
    compiled.outputText,
    { module, exports: module.exports, require: restrictedRequire },
    { filename: TRIAGE_PATH, timeout: 1000 },
  )
  const { triageSchema, quickSchema, detailSchema, runQuickTriage, runDetailTriage } = module.exports
  if (!(triageSchema instanceof z.ZodType) || typeof runQuickTriage !== 'function' || typeof runDetailTriage !== 'function') {
    throw new Error('lib/triage.ts no expone el contrato esperado.')
  }
  return { triageSchema, quickSchema, detailSchema, captureQuick: runQuickTriage, captureDetail: runDetailTriage }
}

function loadFixtures() {
  const fixtures = z.array(fixtureSchema).min(1).parse(JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8')))
  if (new Set(fixtures.map((f) => f.id)).size !== fixtures.length) throw new Error('IDs de fixtures duplicados.')
  return fixtures
}

async function toRequest(captured) {
  const format = await Output.object({ schema: captured.schema }).responseFormat
  if (format.type !== 'json' || !format.schema) throw new Error('Output.object no generó el esquema JSON esperado.')
  return {
    model: MODEL,
    messages: [
      { role: 'system', content: captured.system },
      { role: 'user', content: captured.prompt },
    ],
    temperature: TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: format.schema } },
  }
}

/** Rúbrica determinística: mismo criterio para todos, sin un segundo LLM de juez. */
function assess(candidate, fixture, schema) {
  const parsed = schema.safeParse(candidate)
  const humanReview = [
    'Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías).',
    'Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.',
  ]
  if (fixture.id === 'case-05-struggle-case-burnout') {
    humanReview.push('Caso de dificultad: revisar si prioriza regular el cuerpo sobre la entrega. Las notas del fixture son hipótesis, no observaciones.')
  }
  if (!parsed.success) {
    return { schemaValid: false, schemaIssues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`), checks: [], passed: false, output: null, humanReview }
  }
  const output = parsed.data
  const checks = []
  const check = (name, passed) => checks.push({ name, passed })

  check('Hook de activación no vacío', Boolean(output.momentumMode.activationHook.trim()))
  check('Escudo de foco no vacío', Boolean(output.momentumMode.singleFocusShield.trim()))

  const expected = fixture.expected
  if (expected.traysPopulated) {
    for (const tray of expected.traysPopulated) {
      check(`Bandeja esperada no vacía: ${tray}`, output.trayDispatch[tray].some((t) => t.trim().length > 0))
    }
  }
  if (expected.identifiedCaveTrap) {
    check('Existe al menos una trampa de dopamina descrita (proxy estructural)', output.momentumMode.antiDopamineTraps.some((t) => Boolean(t.activity.trim() && t.warning.trim())))
  }
  if (expected.orderedSequence) {
    check('Secuencia numerada 1..N con tarea y razón no vacías', output.dependencyOrder.length > 0 && output.dependencyOrder.every((s, i) => s.step === i + 1 && Boolean(s.task.trim() && s.whyThisOrder.trim())))
  }
  if (expected.firstActionIsPrerequisite) {
    check('El primer paso no depende de nada pendiente', output.dependencyOrder.length > 0 && output.dependencyOrder[0].dependsOn.length === 0)
  }
  if (expected.microTasksGenerated) {
    check('Micro-tareas y pasos no vacíos', output.microTasks.length > 0 && output.microTasks.every((g) => Boolean(g.originalTask.trim()) && g.atomicSteps.length > 0))
  }
  const steps = output.microTasks.flatMap((g) => g.atomicSteps)
  if (expected.maxMicroTaskMinutes !== undefined) {
    check(`Micro-pasos de 2 a ${expected.maxMicroTaskMinutes} minutos`, steps.length > 0 && steps.every((s) => s.durationMinutes >= 2 && s.durationMinutes <= expected.maxMicroTaskMinutes))
  }
  if (expected.hasPhysicalHook) {
    check('Cada micro-paso tiene título y hook (proxy estructural)', steps.length > 0 && steps.every((s) => Boolean(s.stepTitle.trim() && s.actionableHook.trim())))
  }

  return { schemaValid: true, schemaIssues: [], checks, passed: checks.every((c) => c.passed), output, humanReview }
}

const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() })
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.unknown().optional(),
})

const readUsage = (usage) => {
  const parsed = usageSchema.safeParse(usage)
  return parsed.success ? { promptTokens: parsed.data.prompt_tokens, completionTokens: parsed.data.completion_tokens } : null
}
const estimatedCost = (usage) =>
  usage ? (usage.promptTokens * REFERENCE_PRICING.promptPerMillionUsd + usage.completionTokens * REFERENCE_PRICING.completionPerMillionUsd) / 1_000_000 : null

/** Una llamada. Devuelve el objeto ya parseado o un error contenido. */
async function callOnce(request, apiKey, fetchImpl, timeoutMs) {
  const out = { durationMs: 0, httpStatus: null, finishReason: null, usage: null, error: null, data: null }
  const started = performance.now()
  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    out.httpStatus = response.status
    const body = await response.text()
    if (!response.ok) {
      out.error = `HTTP ${response.status}; cuerpo omitido para proteger credenciales.`
      return out
    }
    let envelope
    try {
      envelope = responseSchema.safeParse(JSON.parse(body))
    } catch {
      out.error = 'Respuesta HTTP no es JSON válido.'
      return out
    }
    if (!envelope.success) {
      out.error = 'Respuesta HTTP sin choices/message válidos.'
      return out
    }
    out.usage = readUsage(envelope.data.usage)
    const choice = envelope.data.choices[0]
    out.finishReason = choice.finish_reason ?? null
    if (choice.finish_reason !== 'stop') {
      out.error = `Generación no finalizada normalmente (${choice.finish_reason ?? 'sin finish_reason'}).`
      return out
    }
    if (!choice.message.content) {
      out.error = 'Respuesta del modelo vacía.'
      return out
    }
    try {
      out.data = JSON.parse(choice.message.content)
    } catch {
      out.error = 'Contenido del modelo no es JSON válido.'
    }
  } catch (error) {
    out.error = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? `Tiempo de espera agotado (${timeoutMs} ms).`
      : 'Fallo de red; detalle omitido para proteger credenciales.'
  } finally {
    out.durationMs = Math.round(performance.now() - started)
  }
  return out
}

/** Un caso completo: fase rápida + fase de detalle, como lo vive el producto. */
async function runCase(fixture, today, contract, apiKey, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const result = {
    id: fixture.id, name: fixture.name, model: MODEL,
    quickMs: 0, detailMs: 0, durationMs: 0,
    promptTokens: 0, completionTokens: 0, estimatedCostUsd: null,
    error: null, assessment: null, success: false,
  }

  const quickRequest = await toRequest(await contract.captureQuick({ rawDump: fixture.rawDump, today, locale: 'es' }))
  const quick = await callOnce(quickRequest, apiKey, fetchImpl, timeoutMs)
  result.quickMs = quick.durationMs
  if (quick.usage) {
    result.promptTokens += quick.usage.promptTokens
    result.completionTokens += quick.usage.completionTokens
  }
  if (quick.error || !quick.data) {
    result.error = `fase rápida: ${quick.error ?? 'sin datos'}`
    result.durationMs = result.quickMs
    result.estimatedCostUsd = estimatedCost(quick.usage)
    return result
  }

  const parsedQuick = contract.quickSchema.safeParse(quick.data)
  if (!parsedQuick.success) {
    result.error = 'fase rápida: no cumple su contrato.'
    result.durationMs = result.quickMs
    return result
  }

  const detailRequest = await toRequest(await contract.captureDetail({ rawDump: fixture.rawDump, today, locale: 'es' }, parsedQuick.data))
  const detail = await callOnce(detailRequest, apiKey, fetchImpl, timeoutMs)
  result.detailMs = detail.durationMs
  if (detail.usage) {
    result.promptTokens += detail.usage.promptTokens
    result.completionTokens += detail.usage.completionTokens
  }
  result.durationMs = result.quickMs + result.detailMs
  result.estimatedCostUsd = estimatedCost({ promptTokens: result.promptTokens, completionTokens: result.completionTokens })

  if (detail.error || !detail.data) {
    result.error = `fase de detalle: ${detail.error ?? 'sin datos'}`
    return result
  }

  result.assessment = assess({ ...parsedQuick.data, ...detail.data }, fixture, contract.triageSchema)
  result.success = result.assessment.passed
  if (!result.success) result.error = 'Falló el contrato Zod o una comprobación determinística.'
  return result
}

function summarize(results) {
  const completedQuick = results.filter((r) => r.quickMs > 0 && !String(r.error ?? '').startsWith('fase rápida'))
  const completedAll = results.filter((r) => r.assessment)
  const withCost = results.filter((r) => r.estimatedCostUsd !== null)
  const mean = (rows, key) => (rows.length ? Math.round(rows.reduce((sum, r) => sum + r[key], 0) / rows.length) : null)
  return {
    attempted: results.length,
    passed: results.filter((r) => r.success).length,
    schemaValid: results.filter((r) => r.assessment?.schemaValid).length,
    meanQuickMs: mean(completedQuick, 'quickMs'),
    meanTotalMs: mean(completedAll, 'durationMs'),
    meanEstimatedCostUsd: withCost.length === results.length && results.length ? withCost.reduce((s, r) => s + r.estimatedCostUsd, 0) / results.length : null,
  }
}

const escapeMarkdown = (s) => s.replace(/[|`<>[\]*_]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const money = (a) => (a === null ? 'N/D' : `$${a.toFixed(6)} USD`)
const hashFile = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function writeReport(results, fixtures, startedAt, today) {
  const summary = summarize(results)
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, `${runId}.json`),
    JSON.stringify(
      {
        runId, startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
        endpoint: `${BASE_URL}/chat/completions`, model: MODEL,
        settings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS, temperature: TEMPERATURE, contextDate: today, phases: 2 },
        referencePricing: REFERENCE_PRICING, targets: TARGETS,
        provenance: { fixturesSha256: hashFile(FIXTURES_PATH), triageSourceSha256: hashFile(TRIAGE_PATH) },
        fixtures, summary, results,
      },
      null, 2,
    ) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  )

  const quickStatus = summary.meanQuickMs === null ? 'Incompleto' : summary.meanQuickMs < TARGETS.quickLatencyMs ? 'Cumple objetivo' : 'No cumple objetivo'

  const markdown = `# Evaluación Nebius — Domi

Fecha: ${startedAt}. Modelo: \`${MODEL}\`.

## Qué se mide y por qué

El producto hace **dos** llamadas, no una: la **fase rápida** devuelve las 4 bandejas y
el arranque —lo que la persona ve y con lo que actúa— y la **fase de detalle** devuelve la
secuencia de dependencias y los micro-pasos. Se partió así después de medir: pedir todo en
una sola respuesta daba entre 9 y 20 segundos según el modelo, y uno de los candidatos se
quedaba sin espacio de salida a media frase. Para alguien con disfunción ejecutiva, veinte
segundos frente a una pantalla en blanco es donde se pierde la sesión.

La rúbrica es determinística por caso (no un segundo modelo juzgando al primero), inspirada
en el patrón de evaluación pointwise del notebook \`day-1-evaluation-and-structured-output\`
del curso de GenAI de Google/Kaggle. Se eligió así a propósito: es gratis, reproducible, y
cada aprobación se puede señalar con el dedo en el código que la verificó.

Evidencia completa y reproducible: [\`${runId}.json\`](evaluation-evidence/${runId}.json).

## Mediciones

| Métrica | Resultado | Alcance |
| --- | --- | --- |
| Casos que pasan contrato + rúbrica | ${summary.passed}/${summary.attempted} | No equivale a precisión semántica completa |
| Conformidad de esquema | ${summary.schemaValid}/${summary.attempted} | Contrato estructural de ambas fases |
| **Latencia de la fase rápida** | **${summary.meanQuickMs ?? 'N/D'} ms** | Lo que la persona espera mirando; objetivo <${TARGETS.quickLatencyMs} ms: ${quickStatus} |
| Latencia total (ambas fases) | ${summary.meanTotalMs ?? 'N/D'} ms | La segunda fase llega cuando ya arrancó |
| Costo medio por vaciado | ${money(summary.meanEstimatedCostUsd)} | Suma de las dos llamadas |

Los precios de referencia ($${REFERENCE_PRICING.promptPerMillionUsd}/M entrada,
$${REFERENCE_PRICING.completionPerMillionUsd}/M salida) **no están verificados** contra la
tarifa vigente y no representan facturación real.

## Resultados por caso

${results
    .map((r) => {
      const a = r.assessment
      return `### ${escapeMarkdown(r.name)}

- Estado: ${r.success ? 'PASA' : 'FALLA'} · rápida: ${r.quickMs} ms · detalle: ${r.detailMs} ms · total: ${r.durationMs} ms.
- Tokens: ${r.promptTokens} entrada / ${r.completionTokens} salida · costo estimado: ${money(r.estimatedCostUsd)}.
${r.error ? `- Error: ${escapeMarkdown(r.error)}.\n` : ''}${a?.schemaIssues.length ? `- Errores de esquema: ${a.schemaIssues.map(escapeMarkdown).join('; ')}.\n` : ''}${a?.output ? `- Arranque observado: ${escapeMarkdown(a.output.momentumMode.activationHook)}.\n` : ''}${a ? a.checks.map((c) => `- ${c.passed ? 'PASA' : 'FALLA'}: ${escapeMarkdown(c.name)}.\n`).join('') : ''}
Revisión humana pendiente: ${(a?.humanReview ?? ['No hubo salida válida evaluable.']).map(escapeMarkdown).join(' ')}
`
    })
    .join('\n')}
## Caso de dificultad

**case-05-struggle-case-burnout**: la persona describe parálisis por sobrecarga sensorial
("mi cabeza va a mil por hora... no puedo respirar bien") junto a un compromiso externo
("prometí entregar el reporte de ventas hoy a las 5pm"). El riesgo medido no es que el JSON
salga mal: es que el modelo empuje la entrega por encima del estado de la persona. Por eso
existe una regla determinística fuera del modelo (\`somatic-override\` en \`lib/verify.ts\`)
que rechaza el resultado si detecta señales de colapso físico y el arranque no regula el
cuerpo primero. El resultado completo de cada corrida queda en la evidencia para revisión
humana.

## Límites y reproducción

${results.length} fixtures sintéticos, en secuencia, sin reintentos, máximo ${MAX_OUTPUT_TOKENS}
tokens por llamada y ${TIMEOUT_MS} ms de espera. Se reutiliza \`lib/triage.ts\` real (mismos
prompts y esquemas que la app), no una copia. No cubre percepción de utilidad ni latencia
end-to-end del navegador.

Sin red: \`node tests/eval.mjs --self-test\` y \`node tests/eval.mjs --dry-run\`.
Con la API real: \`NEBIUS_API_KEY=... node tests/eval.mjs [--model=<id>]\`.
Código de salida: 0 si todo pasa, 1 si algo falla, 2 si falta configuración.
`
  fs.writeFileSync(REPORT_PATH, markdown, 'utf8')
  console.log(`Reporte: ${REPORT_PATH}`)
}

/** Pruebas locales deterministas: fetch inyectado, nunca la red real. */
async function selfTest() {
  const contract = loadTriageContract()
  const fixtures = loadFixtures()
  const fixture = fixtures.find((f) => f.expected.microTasksGenerated)
  assert.ok(fixture)

  const quick = {
    trayDispatch: { personalBienestar: [], profesionalProductiva: ['Contabilidad'], familiarDomestica: [], socialComunitaria: [] },
    momentumMode: { activationHook: 'Abre la carpeta durante dos minutos.', cognitiveLoadLevel: 'alta', antiDopamineTraps: [], singleFocusShield: 'Deja los videos para después.' },
  }
  const detail = {
    dependencyOrder: [{ step: 1, task: 'Abrir carpeta', dependsOn: [], whyThisOrder: 'Localizar recibos.' }],
    microTasks: [{ originalTask: 'Contabilidad', atomicSteps: [{ stepTitle: 'Abrir carpeta', durationMinutes: 2, actionableHook: 'Haz clic en la carpeta de recibos.' }] }],
  }

  assert.equal(assess({ ...quick, ...detail }, fixture, contract.triageSchema).passed, true)
  assert.equal(assess({ ...quick, momentumMode: undefined, ...detail }, fixture, contract.triageSchema).schemaValid, false)
  assert.equal(assess({ ...quick, ...detail, microTasks: [] }, fixture, contract.triageSchema).passed, false)
  assert.equal(
    assess({ ...quick, ...detail, microTasks: [{ originalTask: 'X', atomicSteps: [{ stepTitle: 'X', durationMinutes: 11, actionableHook: 'X' }] }] }, fixture, contract.triageSchema).schemaValid,
    false,
  )

  const quickRequest = await toRequest(await contract.captureQuick({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es' }))
  assert.ok(JSON.stringify(quickRequest).includes(fixture.rawDump))
  assert.ok(JSON.stringify(quickRequest).includes('FECHA DE HOY: 2026-09-11'))
  // La fase rápida no debe pedir micro-pasos: si los pide, no es rápida.
  assert.ok(!JSON.stringify(quickRequest.response_format).includes('microTasks'))

  const detailRequest = await toRequest(await contract.captureDetail({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es' }, quick))
  assert.ok(JSON.stringify(detailRequest.response_format).includes('microTasks'))

  // La memoria recuperada tiene que llegar al prompt; si no, el producto no recuerda.
  const withMemory = await contract.captureQuick({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es', recalled: [{ title: 'Declarar impuestos', status: 'open', timesResurfaced: 4 }] })
  assert.ok(withMemory.prompt.includes('Declarar impuestos'))
  assert.ok(withMemory.prompt.includes('4 veces'))

  const phased = (usage) => {
    let call = 0
    return async () => {
      call += 1
      const payload = call === 1 ? quick : detail
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage }))
    }
  }

  const good = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', phased({ prompt_tokens: 100, completion_tokens: 200 }))
  assert.equal(good.success, true)
  assert.equal(good.promptTokens, 200)

  const httpError = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', async () => new Response('sensitive-body', { status: 429 }))
  assert.equal(httpError.success, false)
  assert.ok(!JSON.stringify(httpError).includes('sensitive-body'))

  const timeout = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', async () => { throw new DOMException('private-detail', 'TimeoutError') }, 1)
  assert.equal(timeout.success, false)
  assert.ok(!JSON.stringify(timeout).includes('private-detail'))

  const summary = summarize([{ ...good, quickMs: 120, durationMs: 300 }, timeout])
  assert.equal(summary.meanQuickMs, 120)
  assert.equal(summary.passed, 1)
  console.log('SELF-TEST OK: dos fases, contrato, rúbrica, memoria en el prompt, HTTP, timeout y credenciales contenidas. 0 llamadas externas.')
}

async function main() {
  const args = process.argv.slice(2)
  const flags = args.filter((a) => !a.startsWith('--model='))
  if (flags.some((a) => !['--dry-run', '--self-test'].includes(a)) || flags.length > 1) {
    throw new Error('Uso: node tests/eval.mjs [--dry-run | --self-test] [--model=<id>]')
  }
  const modelArg = args.find((a) => a.startsWith('--model='))?.slice('--model='.length).trim()
  if (modelArg) MODEL = modelArg
  if (flags[0] === '--self-test') return selfTest()

  const fixtures = loadFixtures()
  const contract = loadTriageContract()
  const startedAt = new Date().toISOString()
  const today = startedAt.slice(0, 10)
  console.log(`Plan: ${fixtures.length} casos x 2 llamadas a ${MODEL}; max_tokens=${MAX_OUTPUT_TOKENS}; timeout=${TIMEOUT_MS}ms.`)
  if (flags[0] === '--dry-run') {
    await toRequest(await contract.captureQuick({ rawDump: fixtures[0].rawDump, today, locale: 'es' }))
    console.log('DRY RUN OK: fixtures, prompts y esquemas listos. 0 llamadas externas.')
    return
  }
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) {
    console.error('NEBIUS_API_KEY no está configurada en este proceso.')
    process.exitCode = 2
    return
  }
  const results = []
  for (const fixture of fixtures) {
    const result = await runCase(fixture, today, contract, apiKey)
    results.push(result)
    console.log(`${result.success ? 'PASA' : 'FALLA'} ${fixture.id}: rápida ${result.quickMs} ms, total ${result.durationMs} ms${result.error ? ` — ${result.error}` : ''}`)
  }
  writeReport(results, fixtures, startedAt, today)
  process.exitCode = results.every((r) => r.success) ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof z.ZodError ? 'Fixtures locales inválidos.' : error instanceof Error ? error.message : 'Falló la configuración del evaluador.')
  process.exitCode = 1
})
