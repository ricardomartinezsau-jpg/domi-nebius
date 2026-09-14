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
const VERIFY_PATH = path.join(ROOT, 'lib/verify.ts')
const REPORT_PATH = path.join(ROOT, 'EVALUATION.md')
const EVIDENCE_DIR = path.join(ROOT, 'evaluation-evidence')
const BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
const TRIAGE_MODEL = process.env.NEBIUS_MODEL?.trim() || 'google/gemma-3-27b-it'
const DETAIL_MODEL = process.env.NEBIUS_RESEARCH_MODEL?.trim() || 'openai/gpt-oss-120b'
const MAX_OUTPUT_TOKENS = 4096

/**
 * El evaluador solo vale si manda la misma petición que el producto. Este
 * techo vivía duplicado aquí y allá, y estuvieron distintos: el producto no
 * mandaba ninguno y el evaluador sí, así que una respuesta desbocada se veía
 * en producción y nunca en la evaluación. Si vuelven a separarse, esto falla.
 */
function assertTokenParity() {
  const source = fs.readFileSync(path.join(ROOT, 'lib/nebius.ts'), 'utf8')
  const declared = source.match(/MAX_OUTPUT_TOKENS\s*=\s*(\d+)/)?.[1]
  if (Number(declared) !== MAX_OUTPUT_TOKENS) {
    throw new Error(`El techo de salida no coincide: lib/nebius.ts usa ${declared ?? '(ninguno)'} y el evaluador ${MAX_OUTPUT_TOKENS}.`)
  }
  if (!/maxOutputTokens:\s*MAX_OUTPUT_TOKENS/.test(source)) {
    throw new Error('lib/nebius.ts declara el techo pero no se lo pasa a la llamada.')
  }
}

/**
 * La ruta real no fija el modelo de triage: deja que generateStructured use
 * DEFAULT_MODEL. La segunda fase sí fija RESEARCH_MODEL. El evaluador vuelve
 * explícitos esos dos valores solamente al armar el request HTTP, por lo que
 * debe fallar si el producto cambia sus defaults o deja de fijar el detalle.
 */
function assertModelParity() {
  const nebius = fs.readFileSync(path.join(ROOT, 'lib/nebius.ts'), 'utf8')
  const triage = fs.readFileSync(TRIAGE_PATH, 'utf8')
  const triageFallback = nebius.match(/export const CANDIDATE_MODELS = \[\s*'([^']+)'/)?.[1]
  const researchFallback = nebius.match(/export const RESEARCH_MODEL = process\.env\.NEBIUS_RESEARCH_MODEL\?\.trim\(\) \|\| '([^']+)'/)?.[1]

  if (!/export const DEFAULT_MODEL = process\.env\.NEBIUS_MODEL\?\.trim\(\) \|\| CANDIDATE_MODELS\[0\]/.test(nebius)) {
    throw new Error('No se pudo comprobar que DEFAULT_MODEL siga siendo el modelo de la fase rápida.')
  }
  if (triageFallback !== 'google/gemma-3-27b-it' || TRIAGE_MODEL !== (process.env.NEBIUS_MODEL?.trim() || triageFallback)) {
    throw new Error(`El modelo rápido no coincide con lib/nebius.ts: evaluador=${TRIAGE_MODEL}, producto=${triageFallback ?? '(ninguno)'}.`)
  }
  if (researchFallback !== 'openai/gpt-oss-120b' || DETAIL_MODEL !== (process.env.NEBIUS_RESEARCH_MODEL?.trim() || researchFallback)) {
    throw new Error(`El modelo de detalle no coincide con lib/nebius.ts: evaluador=${DETAIL_MODEL}, producto=${researchFallback ?? '(ninguno)'}.`)
  }
  if (!/modelId:\s*opts\.modelId\s*\?\?\s*RESEARCH_MODEL/.test(triage)) {
    throw new Error('La fase de detalle ya no fija RESEARCH_MODEL; actualiza el evaluador antes de medir.')
  }
}

const TIMEOUT_MS = 60_000
const TEMPERATURE = 0.2
/**
 * Cada fase usa un modelo distinto, así que nunca se debe sumar su uso con una
 * sola tarifa. Gemma conserva el baseline histórico y gpt-oss una referencia
 * de la tabla pública de Nebius; ambas permanecen sin verificar porque las
 * tarifas son dinámicas. Una anulación de modelo sin tarifa conocida deja el
 * costo como N/D, en vez de inventarlo.
 */
const REFERENCE_PRICING_BY_MODEL = Object.freeze({
  'google/gemma-3-27b-it': {
    promptPerMillionUsd: 0.13,
    completionPerMillionUsd: 0.4,
    verified: false,
    source: 'baseline histórico del evaluador; la tarifa vigente debe verificarse antes de atribuir facturación real',
  },
  'openai/gpt-oss-120b': {
    promptPerMillionUsd: 0.15,
    completionPerMillionUsd: 0.6,
    verified: false,
    source: 'https://nebius.com/token-factory/prices (base; referencia consultada 2026-09-13, confirmar antes de atribuir facturación real)',
  },
})
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

/**
 * Carga un módulo real del producto dentro de una sandbox. No se importa
 * directamente para no depender de que el Node que corra esto sepa leer
 * TypeScript, y para que el evaluador no pueda alcanzar la red por accidente.
 */
function loadModule(modulePath, requireImpl) {
  const source = fs.readFileSync(modulePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: modulePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  if (compiled.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)) {
    throw new Error(`No se pudo transpilar ${path.relative(ROOT, modulePath)}. Ejecuta npm run typecheck primero.`)
  }
  const module = { exports: {} }
  vm.runInNewContext(
    compiled.outputText,
    { module, exports: module.exports, require: requireImpl },
    { filename: modulePath, timeout: 1000 },
  )
  return module.exports
}

/**
 * Las mismas reglas duras que corren en producción antes de mostrar nada.
 * Aquí se aplican a cada caso para que la rúbrica no dependa de que alguien
 * lea el resultado a mano.
 */
function loadVerifyRules() {
  const exported = loadModule(VERIFY_PATH, (id) => {
    throw new Error(`Import no permitido en el evaluador: ${id}`)
  })
  if (typeof exported.verify !== 'function') throw new Error('lib/verify.ts no expone verify().')
  return exported
}

function loadTriageContract() {
  const module = {
    exports: loadModule(TRIAGE_PATH, (id) => {
      if (id === 'zod') return { z }
      if (id === './nebius') return { generateStructured: async (args) => args, RESEARCH_MODEL: DETAIL_MODEL }
      throw new Error(`Import no permitido en el evaluador: ${id}`)
    }),
  }
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

async function toRequest(captured, fallbackModel) {
  const format = await Output.object({ schema: captured.schema }).responseFormat
  if (format.type !== 'json' || !format.schema) throw new Error('Output.object no generó el esquema JSON esperado.')
  const model = captured.modelId ?? fallbackModel
  if (!model || typeof model !== 'string') throw new Error('La fase evaluada no resolvió un modelo de Nebius.')
  return {
    model,
    messages: [
      { role: 'system', content: captured.system },
      { role: 'user', content: captured.prompt },
    ],
    temperature: TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: format.schema } },
  }
}

let verifyModule = null
const rules = () => (verifyModule ??= loadVerifyRules())

/** Rúbrica determinística: mismo criterio para todos, sin un segundo LLM de juez. */
function assess(candidate, fixture, schema) {
  const parsed = schema.safeParse(candidate)
  const humanReview = [
    'Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías).',
    'Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.',
  ]
  if (fixture.id === 'case-05-struggle-case-burnout') {
    humanReview.push('Caso de dificultad: la regla somatic-override se comprueba abajo; lo que queda a revisión humana es si la acción propuesta es adecuada para esta persona, no si regula el cuerpo.')
  }
  if (!parsed.success) {
    return { schemaValid: false, schemaIssues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`), checks: [], passed: false, output: null, humanReview }
  }
  const output = parsed.data
  const checks = []
  const check = (name, passed) => checks.push({ name, passed })

  // Las reglas duras del producto, aplicadas tal cual: si esta evaluación pasa
  // y la app no, o al revés, es que el evaluador dejó de medir lo que se sirve.
  for (const rule of rules().verify(output, { rawDump: fixture.rawDump })) {
    check(`Regla dura · ${rule.id}`, rule.passed)
  }

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

function pricingFor(model) {
  const known = REFERENCE_PRICING_BY_MODEL[model]
  return known
    ? { model, ...known }
    : {
        model,
        promptPerMillionUsd: null,
        completionPerMillionUsd: null,
        verified: false,
        source: 'Sin tarifa de referencia para este modelo; costo no estimado.',
      }
}

function estimatedCost(usage, model) {
  const pricing = pricingFor(model)
  if (!usage || pricing.promptPerMillionUsd === null || pricing.completionPerMillionUsd === null) return null
  return (usage.promptTokens * pricing.promptPerMillionUsd + usage.completionTokens * pricing.completionPerMillionUsd) / 1_000_000
}

function phaseResult(model, call, skipped = false) {
  return {
    model,
    skipped,
    completed: !skipped && !call.error && Boolean(call.data),
    durationMs: call.durationMs,
    httpStatus: call.httpStatus,
    finishReason: call.finishReason,
    promptTokens: call.usage?.promptTokens ?? null,
    completionTokens: call.usage?.completionTokens ?? null,
    estimatedCostUsd: skipped ? null : estimatedCost(call.usage, model),
    pricing: pricingFor(model),
  }
}

function skippedPhase(model) {
  return phaseResult(model, { durationMs: 0, httpStatus: null, finishReason: null, usage: null, error: null, data: null }, true)
}

function sumPhaseCosts(phases) {
  const executed = phases.filter((phase) => !phase.skipped)
  return executed.length && executed.every((phase) => phase.estimatedCostUsd !== null)
    ? executed.reduce((sum, phase) => sum + phase.estimatedCostUsd, 0)
    : null
}

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
async function runCase(fixture, today, contract, apiKey, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, modelPlan = { quick: TRIAGE_MODEL, detail: DETAIL_MODEL }) {
  const models = { quick: modelPlan.quick, detail: modelPlan.detail }
  if (![models.quick, models.detail].every((model) => typeof model === 'string' && model.trim())) {
    throw new Error('Cada fase de la evaluación requiere un modelo explícito.')
  }
  const result = {
    id: fixture.id, name: fixture.name, models,
    phases: { quick: skippedPhase(models.quick), detail: skippedPhase(models.detail) },
    quickMs: 0, detailMs: 0, durationMs: 0,
    promptTokens: 0, completionTokens: 0, estimatedCostUsd: null,
    error: null, assessment: null, success: false,
  }

  const quickOptions = models.quick === TRIAGE_MODEL ? undefined : { modelId: models.quick }
  const quickRequest = await toRequest(
    await contract.captureQuick({ rawDump: fixture.rawDump, today, locale: 'es' }, quickOptions),
    models.quick,
  )
  const quick = await callOnce(quickRequest, apiKey, fetchImpl, timeoutMs)
  result.models.quick = quickRequest.model
  result.phases.quick = phaseResult(quickRequest.model, quick)
  result.quickMs = result.phases.quick.durationMs
  if (quick.usage) {
    result.promptTokens += quick.usage.promptTokens
    result.completionTokens += quick.usage.completionTokens
  }
  if (quick.error || !quick.data) {
    result.error = `fase rápida: ${quick.error ?? 'sin datos'}`
    result.durationMs = result.quickMs
    result.estimatedCostUsd = sumPhaseCosts(Object.values(result.phases))
    return result
  }

  const parsedQuick = contract.quickSchema.safeParse(quick.data)
  if (!parsedQuick.success) {
    result.error = 'fase rápida: no cumple su contrato.'
    result.durationMs = result.quickMs
    result.estimatedCostUsd = sumPhaseCosts(Object.values(result.phases))
    return result
  }

  const detailOptions = models.detail === DETAIL_MODEL ? undefined : { modelId: models.detail }
  const detailRequest = await toRequest(
    await contract.captureDetail({ rawDump: fixture.rawDump, today, locale: 'es' }, parsedQuick.data, detailOptions),
    models.detail,
  )
  const detail = await callOnce(detailRequest, apiKey, fetchImpl, timeoutMs)
  result.models.detail = detailRequest.model
  result.phases.detail = phaseResult(detailRequest.model, detail)
  result.detailMs = result.phases.detail.durationMs
  if (detail.usage) {
    result.promptTokens += detail.usage.promptTokens
    result.completionTokens += detail.usage.completionTokens
  }
  result.durationMs = result.quickMs + result.detailMs
  result.estimatedCostUsd = sumPhaseCosts(Object.values(result.phases))

  if (detail.error || !detail.data) {
    result.error = `fase de detalle: ${detail.error ?? 'sin datos'}`
    return result
  }

  result.assessment = assess({ ...parsedQuick.data, ...detail.data }, fixture, contract.triageSchema)
  result.success = result.assessment.passed
  if (!result.success) result.error = 'Falló el contrato Zod o una comprobación determinística.'
  return result
}

function summarize(results, models = { quick: TRIAGE_MODEL, detail: DETAIL_MODEL }) {
  const phaseSummary = (name) => {
    const executed = results.map((result) => result.phases[name]).filter((phase) => !phase.skipped)
    const completed = executed.filter((phase) => phase.completed)
    const withCost = executed.filter((phase) => phase.estimatedCostUsd !== null)
    return {
      model: models[name],
      executed: executed.length,
      completed: completed.length,
      meanLatencyMs: completed.length ? Math.round(completed.reduce((sum, phase) => sum + phase.durationMs, 0) / completed.length) : null,
      costCoverage: `${withCost.length}/${executed.length}`,
      meanEstimatedCostUsd: withCost.length === executed.length && executed.length
        ? withCost.reduce((sum, phase) => sum + phase.estimatedCostUsd, 0) / executed.length
        : null,
    }
  }
  const quick = phaseSummary('quick')
  const detail = phaseSummary('detail')
  const completedAll = results.filter((r) => r.assessment)
  const withCost = results.filter((r) => r.estimatedCostUsd !== null)
  const mean = (rows, key) => (rows.length ? Math.round(rows.reduce((sum, r) => sum + r[key], 0) / rows.length) : null)
  return {
    attempted: results.length,
    passed: results.filter((r) => r.success).length,
    schemaValid: results.filter((r) => r.assessment?.schemaValid).length,
    quick,
    detail,
    total: {
      completed: completedAll.length,
      meanLatencyMs: mean(completedAll, 'durationMs'),
      costCoverage: `${withCost.length}/${results.length}`,
      meanEstimatedCostUsd: withCost.length === results.length && results.length ? withCost.reduce((s, r) => s + r.estimatedCostUsd, 0) / results.length : null,
    },
    // Campos planos conservados para que consumidores de evidencia anteriores
    // no cambien de semántica sin darse cuenta.
    meanQuickMs: quick.meanLatencyMs,
    meanTotalMs: mean(completedAll, 'durationMs'),
    meanEstimatedCostUsd: withCost.length === results.length && results.length ? withCost.reduce((s, r) => s + r.estimatedCostUsd, 0) / results.length : null,
  }
}

const escapeMarkdown = (s) => s.replace(/[|`<>[\]*_]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const money = (a) => (a === null ? 'N/D' : `$${a.toFixed(6)} USD`)
const tokens = (n) => (n === null ? 'N/D' : String(n))
const pricingLine = (pricing) => pricing.promptPerMillionUsd === null
  ? `\`${pricing.model}\`: sin tarifa de referencia; costo N/D.`
  : `\`${pricing.model}\`: $${pricing.promptPerMillionUsd}/M entrada y $${pricing.completionPerMillionUsd}/M salida (${pricing.verified ? 'verificada' : 'no verificada'}; ${pricing.source}).`
const hashFile = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function writeReport(results, fixtures, startedAt, today, models = { quick: TRIAGE_MODEL, detail: DETAIL_MODEL }) {
  const summary = summarize(results, models)
  const referencePricing = { quick: pricingFor(models.quick), detail: pricingFor(models.detail) }
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, `${runId}.json`),
    JSON.stringify(
      {
        runId, startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version,
        endpoint: `${BASE_URL}/chat/completions`, models,
        settings: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: TIMEOUT_MS,
          temperature: TEMPERATURE,
          contextDate: today,
          phases: {
            quick: { model: models.quick, purpose: 'bandejas y arranque visible' },
            detail: { model: models.detail, purpose: 'dependencias y micro-pasos en segundo plano' },
          },
        },
        referencePricing, targets: TARGETS,
        provenance: { fixturesSha256: hashFile(FIXTURES_PATH), triageSourceSha256: hashFile(TRIAGE_PATH) },
        fixtures, summary, results,
      },
      null, 2,
    ) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  )

  const quickStatus = summary.quick.meanLatencyMs === null ? 'Incompleto' : summary.quick.meanLatencyMs < TARGETS.quickLatencyMs ? 'Cumple objetivo' : 'No cumple objetivo'

  const markdown = `# Evaluación Nebius — Domi

Fecha: ${startedAt}. Fase rápida: \`${models.quick}\`. Fase de detalle: \`${models.detail}\`.

## Qué se mide y por qué

El producto hace **dos** llamadas, no una: la **fase rápida** devuelve las 4 bandejas y
el arranque —lo que la persona ve y con lo que actúa— y la **fase de detalle** devuelve la
secuencia de dependencias y los micro-pasos. Se partió así después de medir: pedir todo en
una sola respuesta daba entre 9 y 20 segundos según el modelo, y uno de los candidatos se
quedaba sin espacio de salida a media frase. Para alguien con disfunción ejecutiva, veinte
segundos frente a una pantalla en blanco es donde se pierde la sesión.

Esta corrida reproduce los modelos que sirve el producto: \`${models.quick}\` para el triage
visible y \`${models.detail}\` para el detalle. Cada request y cada resultado conserva el
modelo, tokens, latencia y estimación de costo de su propia fase; no se aplica una sola tarifa
a dos modelos distintos.

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
| **Latencia rápida — \`${models.quick}\`** | **${summary.quick.meanLatencyMs ?? 'N/D'} ms** | ${summary.quick.completed}/${summary.quick.executed} respuestas completas; objetivo <${TARGETS.quickLatencyMs} ms: ${quickStatus} |
| Latencia detalle — \`${models.detail}\` | ${summary.detail.meanLatencyMs ?? 'N/D'} ms | ${summary.detail.completed}/${summary.detail.executed} respuestas completas; llega en segundo plano |
| Latencia total (ambas fases) | ${summary.total.meanLatencyMs ?? 'N/D'} ms | ${summary.total.completed}/${summary.attempted} casos con las dos fases evaluables |
| Costo medio rápido | ${money(summary.quick.meanEstimatedCostUsd)} | Cobertura de costo: ${summary.quick.costCoverage} |
| Costo medio detalle | ${money(summary.detail.meanEstimatedCostUsd)} | Cobertura de costo: ${summary.detail.costCoverage} |
| Costo medio por vaciado | ${money(summary.total.meanEstimatedCostUsd)} | Suma de ambas fases; cobertura: ${summary.total.costCoverage} |

Tarifas de referencia por fase (una estimación no sustituye la facturación de Nebius):

- ${pricingLine(referencePricing.quick)}
- ${pricingLine(referencePricing.detail)}

## Resultados por caso

${results
    .map((r) => {
      const a = r.assessment
      const quick = r.phases.quick
      const detail = r.phases.detail
      return `### ${escapeMarkdown(r.name)}

- Estado: ${r.success ? 'PASA' : 'FALLA'} · rápida: ${r.quickMs} ms · detalle: ${r.detailMs} ms · total: ${r.durationMs} ms.
- Rápida — \`${quick.model}\`: ${tokens(quick.promptTokens)} entrada / ${tokens(quick.completionTokens)} salida · ${quick.completed ? `${quick.durationMs} ms` : 'sin respuesta completa'} · costo: ${money(quick.estimatedCostUsd)}.
- Detalle — \`${detail.model}\`: ${detail.skipped ? 'no llamada por fallo previo.' : `${tokens(detail.promptTokens)} entrada / ${tokens(detail.completionTokens)} salida · ${detail.completed ? `${detail.durationMs} ms` : 'sin respuesta completa'} · costo: ${money(detail.estimatedCostUsd)}.`}
- Total: ${r.promptTokens} entrada / ${r.completionTokens} salida · costo estimado: ${money(r.estimatedCostUsd)}.
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
cuerpo primero. Esa regla corre en los dos sitios: en esta rúbrica, como una comprobación
más de cada caso, y en \`app/api/triage/route.ts\` antes de que la persona vea nada. Si el
modelo insiste tras un intento de corrección, el arranque lo sustituye un texto fijo escrito
a mano: la garantía no depende de que el modelo obedezca. El resultado completo de cada
corrida queda en la evidencia para revisión humana.

## Límites y reproducción

${results.length} fixtures sintéticos, en secuencia, sin reintentos, máximo ${MAX_OUTPUT_TOKENS}
tokens por llamada y ${TIMEOUT_MS} ms de espera. Se reutiliza \`lib/triage.ts\` real (mismos
prompts y esquemas que la app), no una copia. No cubre percepción de utilidad ni latencia
end-to-end del navegador.

Sin red: \`node tests/eval.mjs --self-test\` y \`node tests/eval.mjs --dry-run\`.
Con la API real y los defaults del producto: \`NEBIUS_API_KEY=... node tests/eval.mjs\`.
Para una comparación explícita, usa \`--quick-model=<id>\` y/o \`--detail-model=<id>\`; el alias
\`--model=<id>\` fuerza ambas fases y deja de representar el flujo servido.
Código de salida: 0 si todo pasa, 1 si algo falla, 2 si falta configuración.
`
  fs.writeFileSync(REPORT_PATH, markdown, 'utf8')
  console.log(`Reporte: ${REPORT_PATH}`)
}

/** Pruebas locales deterministas: fetch inyectado, nunca la red real. */
async function selfTest() {
  assertTokenParity()
  assertModelParity()
  const models = { quick: TRIAGE_MODEL, detail: DETAIL_MODEL }
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

  const quickRequest = await toRequest(
    await contract.captureQuick({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es' }),
    models.quick,
  )
  assert.ok(JSON.stringify(quickRequest).includes(fixture.rawDump))
  assert.ok(JSON.stringify(quickRequest).includes('FECHA DE HOY: 2026-09-11'))
  assert.equal(quickRequest.model, models.quick)
  // La fase rápida no debe pedir micro-pasos: si los pide, no es rápida.
  assert.ok(!JSON.stringify(quickRequest.response_format).includes('microTasks'))

  const detailRequest = await toRequest(
    await contract.captureDetail({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es' }, quick),
    models.detail,
  )
  assert.ok(JSON.stringify(detailRequest.response_format).includes('microTasks'))
  assert.equal(detailRequest.model, models.detail)

  // La memoria recuperada tiene que llegar al prompt; si no, el producto no recuerda.
  const withMemory = await contract.captureQuick({ rawDump: fixture.rawDump, today: '2026-09-11', locale: 'es', recalled: [{ title: 'Declarar impuestos', status: 'open', timesResurfaced: 4 }] })
  assert.ok(withMemory.prompt.includes('Declarar impuestos'))
  assert.ok(withMemory.prompt.includes('4 veces'))

  const phased = (usage) => {
    let call = 0
    const requestedModels = []
    const fetchImpl = async (_url, init) => {
      call += 1
      requestedModels.push(JSON.parse(init.body).model)
      const payload = call === 1 ? quick : detail
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage }))
    }
    return { fetchImpl, requestedModels }
  }

  const recorded = phased({ prompt_tokens: 100, completion_tokens: 200 })
  const good = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', recorded.fetchImpl)
  assert.equal(good.success, true)
  assert.equal(good.promptTokens, 200)
  assert.deepEqual(recorded.requestedModels, [models.quick, models.detail])
  assert.equal(good.phases.quick.model, models.quick)
  assert.equal(good.phases.detail.model, models.detail)
  assert.equal(good.phases.quick.pricing.verified, false)
  assert.equal(good.phases.detail.pricing.verified, false)

  const httpError = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', async () => new Response('sensitive-body', { status: 429 }))
  assert.equal(httpError.success, false)
  assert.ok(!JSON.stringify(httpError).includes('sensitive-body'))

  const timeout = await runCase(fixture, '2026-09-11', contract, 'offline-placeholder', async () => { throw new DOMException('private-detail', 'TimeoutError') }, 1)
  assert.equal(timeout.success, false)
  assert.ok(!JSON.stringify(timeout).includes('private-detail'))

  const summary = summarize([
    { ...good, quickMs: 120, durationMs: 300, phases: { ...good.phases, quick: { ...good.phases.quick, durationMs: 120 } } },
    timeout,
  ], models)
  assert.equal(summary.meanQuickMs, 120)
  assert.equal(summary.quick.model, models.quick)
  assert.equal(summary.detail.model, models.detail)
  assert.equal(summary.passed, 1)
  console.log('SELF-TEST OK: dos modelos por fase, contrato, rúbrica, memoria en el prompt, HTTP, timeout y credenciales contenidas. 0 llamadas externas.')
}

function parseArgs(args) {
  let mode = null
  let allPhasesModel = null
  let quickModel = null
  let detailModel = null

  for (const arg of args) {
    if (arg === '--dry-run' || arg === '--self-test') {
      if (mode) throw new Error('Elige solo uno: --dry-run o --self-test.')
      mode = arg
      continue
    }
    const assign = (prefix, apply) => {
      if (!arg.startsWith(prefix)) return false
      const value = arg.slice(prefix.length).trim()
      if (!value) throw new Error(`Falta el identificador después de ${prefix}.`)
      apply(value)
      return true
    }
    if (assign('--model=', (value) => { allPhasesModel = value })) continue
    if (assign('--quick-model=', (value) => { quickModel = value })) continue
    if (assign('--detail-model=', (value) => { detailModel = value })) continue
    throw new Error('Uso: node tests/eval.mjs [--dry-run | --self-test] [--quick-model=<id>] [--detail-model=<id>] [--model=<id>]')
  }

  if (allPhasesModel && (quickModel || detailModel)) {
    throw new Error('--model no se combina con --quick-model ni --detail-model.')
  }
  return {
    mode,
    models: {
      quick: allPhasesModel ?? quickModel ?? TRIAGE_MODEL,
      detail: allPhasesModel ?? detailModel ?? DETAIL_MODEL,
    },
  }
}

async function main() {
  const { mode, models } = parseArgs(process.argv.slice(2))
  if (mode === '--self-test') return selfTest()

  assertTokenParity()
  assertModelParity()

  const fixtures = loadFixtures()
  const contract = loadTriageContract()
  const startedAt = new Date().toISOString()
  const today = startedAt.slice(0, 10)
  console.log(`Plan: ${fixtures.length} casos x 2 llamadas; rápida=${models.quick}; detalle=${models.detail}; max_tokens=${MAX_OUTPUT_TOKENS}; timeout=${TIMEOUT_MS}ms.`)
  if (mode === '--dry-run') {
    const context = { rawDump: fixtures[0].rawDump, today, locale: 'es' }
    const quickOptions = models.quick === TRIAGE_MODEL ? undefined : { modelId: models.quick }
    await toRequest(await contract.captureQuick(context, quickOptions), models.quick)
    const quickForDetail = contract.quickSchema.parse({
      trayDispatch: { personalBienestar: [], profesionalProductiva: [], familiarDomestica: [], socialComunitaria: [] },
      momentumMode: { activationHook: 'Toma agua por dos minutos.', cognitiveLoadLevel: 'alta', antiDopamineTraps: [], singleFocusShield: 'Solo eso por ahora.' },
    })
    const detailOptions = models.detail === DETAIL_MODEL ? undefined : { modelId: models.detail }
    await toRequest(await contract.captureDetail(context, quickForDetail, detailOptions), models.detail)
    console.log('DRY RUN OK: fixtures, prompts/esquemas y modelos de ambas fases listos. 0 llamadas externas.')
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
    const result = await runCase(fixture, today, contract, apiKey, fetch, TIMEOUT_MS, models)
    results.push(result)
    console.log(`${result.success ? 'PASA' : 'FALLA'} ${result.id}: rápida ${result.quickMs} ms (${result.phases.quick.model}), detalle ${result.detailMs} ms (${result.phases.detail.model}), total ${result.durationMs} ms${result.error ? ` — ${result.error}` : ''}`)
  }
  writeReport(results, fixtures, startedAt, today, models)
  process.exitCode = results.every((r) => r.success) ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof z.ZodError ? 'Fixtures locales inválidos.' : error instanceof Error ? error.message : 'Falló la configuración del evaluador.')
  process.exitCode = 1
})
