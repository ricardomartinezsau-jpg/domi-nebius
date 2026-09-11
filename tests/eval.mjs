/**
 * Evaluación reproducible de Nebius Token Factory para el triage de Domi.
 *
 * Sin red en --dry-run y --self-test. El modo real exige NEBIUS_API_KEY en
 * este proceso (no se lee de archivos .env implícitamente).
 *
 * Reutiliza el prompt y el esquema Zod reales de lib/triage.ts transpilándolo
 * en una sandbox que sustituye lib/nebius.ts por una función que solo captura
 * {system, prompt, schema} — así se construye la solicitud exacta que vería
 * el modelo sin hacer ninguna llamada de red al armar los casos.
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
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct'
const MAX_OUTPUT_TOKENS = 4096
const TIMEOUT_MS = 60_000
const TEMPERATURE = 0.2 // Debe coincidir con lib/nebius.ts.
// Precios de referencia históricos, NO verificados contra la tarifa vigente de Nebius.
const REFERENCE_PRICING = { promptPerMillionUsd: 0.13, completionPerMillionUsd: 0.4, verified: false }
const TARGETS = { averageLatencyMs: 3500, averageEstimatedCostUsd: 0.001 }

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

/**
 * Carga solo código de este repositorio. Sustituye su import de './nebius'
 * por una función que captura {system, prompt, schema} sin red, sin
 * NEBIUS_API_KEY y sin tocar el SDK.
 */
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
  const schema = module.exports.triageSchema
  if (!(schema instanceof z.ZodType) || typeof module.exports.runTriage !== 'function') {
    throw new Error('No se encontraron triageSchema y runTriage en lib/triage.ts.')
  }
  return { schema, capture: module.exports.runTriage }
}

function loadFixtures() {
  const fixtures = z.array(fixtureSchema).min(1).parse(JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8')))
  if (new Set(fixtures.map((f) => f.id)).size !== fixtures.length) throw new Error('IDs de fixtures duplicados.')
  return fixtures
}

async function buildRequest(fixture, today, contract) {
  const captured = await contract.capture({ rawDump: fixture.rawDump, today, locale: 'es' })
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

/** Rúbrica determinística: mismo criterio para todo el mundo, sin un segundo LLM de por medio. */
function assess(candidate, fixture, schema) {
  const parsed = schema.safeParse(candidate)
  const humanReview = [
    'Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías).',
    'Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.',
  ]
  if (fixture.id === 'case-05-struggle-case-burnout') {
    humanReview.push('Caso de dificultad: revisar manualmente si prioriza la regulación somática sobre la entrega. Las notas del fixture son una hipótesis, no una observación.')
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
    check(
      'Secuencia numerada 1..N con tarea y razón no vacías',
      output.dependencyOrder.length > 0 && output.dependencyOrder.every((step, i) => step.step === i + 1 && Boolean(step.task.trim() && step.whyThisOrder.trim())),
    )
  }
  if (expected.firstActionIsPrerequisite) {
    check('El primer paso no depende de nada pendiente (es el punto de partida real)', output.dependencyOrder.length > 0 && output.dependencyOrder[0].dependsOn.length === 0)
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

const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative().optional() })
const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1), usage: z.unknown().optional() })

function readUsage(usage) {
  const parsed = usageSchema.safeParse(usage)
  return parsed.success ? { promptTokens: parsed.data.prompt_tokens, completionTokens: parsed.data.completion_tokens, totalTokens: parsed.data.total_tokens ?? null } : null
}

function estimatedCost(usage) {
  return usage ? (usage.promptTokens * REFERENCE_PRICING.promptPerMillionUsd + usage.completionTokens * REFERENCE_PRICING.completionPerMillionUsd) / 1_000_000 : null
}

async function callNebius(fixture, request, apiKey, schema, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const result = { id: fixture.id, name: fixture.name, durationMs: 0, responseCompleted: false, httpStatus: null, finishReason: null, usage: null, estimatedCostUsd: null, error: null, assessment: null, success: false }
  const started = performance.now()
  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    result.httpStatus = response.status
    const body = await response.text()
    result.responseCompleted = true
    if (!response.ok) {
      result.error = `HTTP ${response.status}; cuerpo omitido para proteger credenciales.`
      return result
    }
    let envelope
    try {
      envelope = responseSchema.safeParse(JSON.parse(body))
    } catch {
      result.error = 'Respuesta HTTP no es JSON válido.'
      return result
    }
    if (!envelope.success) {
      result.error = 'Respuesta HTTP sin choices/message válidos.'
      return result
    }
    result.usage = readUsage(envelope.data.usage)
    result.estimatedCostUsd = estimatedCost(result.usage)
    const choice = envelope.data.choices[0]
    result.finishReason = choice.finish_reason ?? null
    if (choice.finish_reason !== 'stop') {
      result.error = `Generación no finalizada normalmente (${choice.finish_reason ?? 'sin finish_reason'}).`
      return result
    }
    if (!choice.message.content) {
      result.error = 'Respuesta del modelo vacía.'
      return result
    }
    let output
    try {
      output = JSON.parse(choice.message.content)
    } catch {
      result.error = 'Contenido del modelo no es JSON válido.'
      return result
    }
    result.assessment = assess(output, fixture, schema)
    result.success = result.assessment.passed
    if (!result.success) result.error = 'Falló el contrato Zod o una comprobación determinística.'
  } catch (error) {
    result.error = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? `Tiempo de espera agotado (${timeoutMs} ms).` : 'Fallo de red; detalle omitido para proteger credenciales.'
  } finally {
    result.durationMs = Math.round(performance.now() - started)
  }
  return result
}

function summarize(results) {
  const completed = results.filter((r) => r.responseCompleted && r.httpStatus === 200 && r.finishReason === 'stop')
  const withUsage = results.filter((r) => r.estimatedCostUsd !== null)
  const meanLatencyMs = completed.length ? Math.round(completed.reduce((sum, r) => sum + r.durationMs, 0) / completed.length) : null
  const knownEstimatedCostUsd = withUsage.reduce((sum, r) => sum + r.estimatedCostUsd, 0)
  return {
    attempted: results.length,
    passed: results.filter((r) => r.success).length,
    schemaValid: results.filter((r) => r.assessment?.schemaValid).length,
    completedResponses: completed.length,
    meanLatencyMs,
    usageCoverage: withUsage.length,
    meanEstimatedCostUsd: withUsage.length === results.length && results.length ? knownEstimatedCostUsd / results.length : null,
  }
}

const escapeMarkdown = (s) => s.replace(/[|`<>[\]*_]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const money = (amount) => (amount === null ? 'N/D' : `$${amount.toFixed(6)} USD`)
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function writeReport(results, fixtures, startedAt, today) {
  const summary = summarize(results)
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const evidencePath = path.join(EVIDENCE_DIR, `${runId}.json`)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        nodeVersion: process.version,
        endpoint: `${BASE_URL}/chat/completions`,
        model: MODEL,
        settings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS, temperature: TEMPERATURE, contextDate: today },
        referencePricing: REFERENCE_PRICING,
        targets: TARGETS,
        provenance: { fixturesSha256: hashFile(FIXTURES_PATH), triageSourceSha256: hashFile(TRIAGE_PATH) },
        fixtures,
        summary,
        results,
      },
      null,
      2,
    ) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  )

  const latencyStatus = summary.completedResponses !== summary.attempted || summary.meanLatencyMs === null ? 'Incompleto' : summary.meanLatencyMs < TARGETS.averageLatencyMs ? 'Cumple objetivo' : 'No cumple objetivo'
  const costStatus = summary.meanEstimatedCostUsd === null ? 'Incompleto' : summary.meanEstimatedCostUsd < TARGETS.averageEstimatedCostUsd ? 'Dentro de referencia; tarifa sin verificar' : 'Fuera de referencia; tarifa sin verificar'

  const markdown = `# Evaluación Nebius — Domi (MVP mínimo)

Fecha: ${startedAt}. Modelo: \`${MODEL}\`.

Metodología: rúbrica determinística por caso (no un segundo LLM como juez), inspirada en el
patrón de evaluación pointwise del notebook \`day-1-evaluation-and-structured-output.ipynb\`
del curso de 5 días de GenAI de Google/Kaggle. Se eligió determinística y no LLM-juez a
propósito: es gratis, reproducible bit a bit, y cada aprobación se puede explicar señalando
la línea de código que la verificó — más defendible ante un jurado que "otro modelo dijo que
está bien".

Evidencia completa de esta corrida: [\`${runId}.json\`](evaluation-evidence/${runId}.json)
(sin credenciales; incluye solicitudes, respuestas, fallos, uso de tokens y hashes de los
archivos evaluados).

## Mediciones

| Métrica | Resultado | Alcance |
| --- | --- | --- |
| Generaciones completas | ${summary.completedResponses}/${summary.attempted} | HTTP 200 y finish_reason=stop |
| Latencia media | ${summary.meanLatencyMs ?? 'N/D'} ms | objetivo <${TARGETS.averageLatencyMs} ms: ${latencyStatus} |
| Costo medio estimado | ${money(summary.meanEstimatedCostUsd)} | ${costStatus} |
| Conformidad de esquema (Zod) | ${summary.schemaValid}/${summary.attempted} | Contrato estructural |
| Contrato + rúbrica determinística | ${summary.passed}/${summary.attempted} | No equivale a precisión semántica completa |

El costo usa precios de referencia sin verificar: $${REFERENCE_PRICING.promptPerMillionUsd}/M
tokens de entrada y $${REFERENCE_PRICING.completionPerMillionUsd}/M de salida. No representa
facturación real de la cuenta.

## Resultados por caso

${results
    .map((result) => {
      const a = result.assessment
      const output = a?.output
      return `### ${escapeMarkdown(result.name)}

- Estado: ${result.success ? 'PASA' : 'FALLA'} · duración: ${result.durationMs} ms · HTTP: ${result.httpStatus ?? 'N/D'}.
- Tokens: ${result.usage ? `${result.usage.promptTokens} entrada / ${result.usage.completionTokens} salida` : 'N/D'} · costo estimado: ${money(result.estimatedCostUsd)}.
${result.error ? `- Error: ${escapeMarkdown(result.error)}.\n` : ''}${a?.schemaIssues.length ? `- Errores de esquema: ${a.schemaIssues.map(escapeMarkdown).join('; ')}.\n` : ''}${output ? `- Hook de activación observado: ${escapeMarkdown(output.momentumMode.activationHook)}.\n` : ''}${a ? a.checks.map((c) => `- ${c.passed ? 'PASA' : 'FALLA'}: ${escapeMarkdown(c.name)}.\n`).join('') : ''}
Revisión humana pendiente: ${(a?.humanReview ?? ['No hubo salida válida evaluable.']).map(escapeMarkdown).join(' ')}
`
    })
    .join('\n')}
## Caso de dificultad

**case-05-struggle-case-burnout**: la persona describe parálisis por sobrecarga sensorial
("mi cabeza va a mil por hora... no puedo respirar bien") junto con un compromiso externo
("prometí entregar el reporte de ventas hoy a las 5pm"). No hay aserciones automáticas duras
para este caso — el resultado completo queda en la evidencia de esta corrida para revisión
humana: si el modelo prioriza la entrega sobre la regulación del estado de la persona, es una
falla de producto real aunque el JSON sea válido.

## Límites y reproducción

Se ejecutan ${results.length} fixtures sintéticos, en secuencia, sin reintentos, con máximo
${MAX_OUTPUT_TOKENS} tokens de salida y ${TIMEOUT_MS} ms por llamada. Se reutiliza
\`lib/triage.ts\` real (mismo prompt y esquema que usa la app en producción, no una copia).
No cubre percepción de utilidad ni latencia end-to-end del navegador.

Validación local sin red: \`node tests/eval.mjs --self-test\` y \`node tests/eval.mjs --dry-run\`.
Para repetir con la API real: \`NEBIUS_API_KEY=tu_clave node tests/eval.mjs\`. Código de
salida: 0 si pasan todos los checks automáticos, 1 si alguno falla, 2 si falta configuración.
`
  fs.writeFileSync(REPORT_PATH, markdown, 'utf8')
  console.log(`Reporte: ${REPORT_PATH}\nEvidencia: ${evidencePath}`)
}

/** Pruebas locales deterministas: fetch inyectado, nunca la red real. */
async function selfTest() {
  const contract = loadTriageContract()
  const fixtures = loadFixtures()
  const fixture = fixtures.find((f) => f.expected.microTasksGenerated)
  assert.ok(fixture)
  const request = await buildRequest(fixture, '2026-09-11', contract)

  const valid = {
    trayDispatch: { personalBienestar: [], profesionalProductiva: ['Contabilidad'], familiarDomestica: [], socialComunitaria: [] },
    dependencyOrder: [{ step: 1, task: 'Abrir carpeta', dependsOn: [], whyThisOrder: 'Localizar recibos.' }],
    microTasks: [{ originalTask: 'Contabilidad', atomicSteps: [{ stepTitle: 'Abrir carpeta', durationMinutes: 2, actionableHook: 'Haz clic en la carpeta de recibos.' }] }],
    momentumMode: { activationHook: 'Abre la carpeta durante dos minutos.', cognitiveLoadLevel: 'alta', antiDopamineTraps: [], singleFocusShield: 'Deja los videos para después de abrir la carpeta.' },
  }
  assert.equal(assess(valid, fixture, contract.schema).passed, true)
  assert.equal(assess({ ...valid, momentumMode: undefined }, fixture, contract.schema).schemaValid, false)
  assert.equal(assess({ ...valid, microTasks: [{ originalTask: 'X', atomicSteps: [{ stepTitle: 'X', durationMinutes: 11, actionableHook: 'X' }] }] }, fixture, contract.schema).schemaValid, false)
  assert.equal(assess({ ...valid, microTasks: [] }, fixture, contract.schema).passed, false)

  const requestText = JSON.stringify(request)
  assert.ok(requestText.includes(fixture.rawDump))
  assert.ok(requestText.includes('FECHA DE HOY: 2026-09-11'))
  assert.equal(request.max_tokens, MAX_OUTPUT_TOKENS)

  const fake = (content, usage, finishReason = 'stop') => async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finishReason }], usage }))

  const good = await callNebius(fixture, request, 'offline-placeholder', contract.schema, fake(valid, { prompt_tokens: 100, completion_tokens: 200 }))
  assert.equal(good.success, true)
  const missingUsage = await callNebius(fixture, request, 'offline-placeholder', contract.schema, fake(valid, undefined))
  assert.equal(missingUsage.estimatedCostUsd, null)
  const truncated = await callNebius(fixture, request, 'offline-placeholder', contract.schema, fake(valid, undefined, 'length'))
  assert.equal(truncated.success, false)
  const badJson = await callNebius(fixture, request, 'offline-placeholder', contract.schema, fake('{', undefined))
  assert.equal(badJson.success, false)
  const httpError = await callNebius(fixture, request, 'offline-placeholder', contract.schema, async () => new Response('sensitive-body', { status: 429 }))
  assert.equal(httpError.success, false)
  assert.ok(!JSON.stringify(httpError).includes('sensitive-body'))
  const timeout = await callNebius(fixture, request, 'offline-placeholder', contract.schema, async () => { throw new DOMException('private-detail', 'TimeoutError') }, 1)
  assert.equal(timeout.responseCompleted, false)
  assert.ok(!JSON.stringify(timeout).includes('private-detail'))

  const summary = summarize([{ ...good, durationMs: 120 }, { ...timeout, durationMs: 60000 }])
  assert.equal(summary.meanLatencyMs, 120)
  assert.equal(summary.meanEstimatedCostUsd, null)
  assert.equal(summary.passed, 1)
  console.log('SELF-TEST OK: contrato, rúbrica, fixtures, JSON inválido, truncamiento, HTTP, timeout y uso ausente. 0 llamadas externas; reporte no sobrescrito.')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((a) => !['--dry-run', '--self-test'].includes(a)) || args.length > 1) {
    throw new Error('Uso: node tests/eval.mjs [--dry-run | --self-test]')
  }
  if (args[0] === '--self-test') return selfTest()

  const fixtures = loadFixtures()
  const contract = loadTriageContract()
  const startedAt = new Date().toISOString()
  const today = startedAt.slice(0, 10)
  const requests = await Promise.all(fixtures.map((f) => buildRequest(f, today, contract)))
  console.log(`Plan: ${fixtures.length} llamadas secuenciales a ${MODEL}; max_tokens=${MAX_OUTPUT_TOKENS}; timeout=${TIMEOUT_MS}ms; temperature=${TEMPERATURE}.`)
  if (args[0] === '--dry-run') {
    console.log('DRY RUN OK: fixtures, prompt y esquema listos. 0 llamadas externas; reporte intacto.')
    return
  }
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) {
    console.error('NEBIUS_API_KEY no está configurada en este proceso. No la pegues en el chat.')
    process.exitCode = 2
    return
  }
  const results = []
  for (const [index, fixture] of fixtures.entries()) {
    const result = await callNebius(fixture, requests[index], apiKey, contract.schema)
    results.push(result)
    console.log(`${result.success ? 'PASA' : 'FALLA'} ${fixture.id}: ${result.durationMs} ms; ${result.error ?? 'contrato y checks automáticos válidos'}`)
  }
  writeReport(results, fixtures, startedAt, today)
  process.exitCode = results.every((r) => r.success) ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof z.ZodError ? 'Fixtures locales inválidos; revisa su contrato.' : error instanceof Error ? error.message : 'Falló la configuración del evaluador.')
  process.exitCode = 1
})
