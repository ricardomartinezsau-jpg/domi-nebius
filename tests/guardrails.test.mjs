/**
 * Las reglas duras de lib/verify.ts, sin red y sin modelo.
 *
 * Existen porque EVALUATION.md afirma ante un lector externo que hay una regla
 * determinística fuera del modelo que frena el resultado cuando la persona da
 * señales de colapso físico. Esa afirmación tiene que poder comprobarse aquí.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DECOMPOSITION_BUDGET,
  SAFE_SOMATIC_HOOK,
  STEP_BUDGET,
  clampDetail,
  failures,
  repairInstruction,
  verifyDetail,
  verifyQuick,
} from '../lib/verify.ts'

const CRISIS = 'Estoy en parálisis total frente a la pantalla y siento que no puedo respirar bien, pero prometí entregar el reporte hoy a las 5pm.'
const CALMA = 'Tengo que mandar la propuesta, comprar despensa y llamar a mi hermana.'

const quick = (momentum) => ({
  trayDispatch: { personalBienestar: [], profesionalProductiva: [], familiarDomestica: [], socialComunitaria: [] },
  momentumMode: {
    activationHook: 'Abre el borrador del reporte y escribe el título.',
    cognitiveLoadLevel: 'alta',
    antiDopamineTraps: [],
    singleFocusShield: 'Deja el correo cerrado hasta las 5.',
    ...momentum,
  },
})

const detail = (over) => ({
  dependencyOrder: [{ step: 1, task: 'Revisar números', dependsOn: [], whyThisOrder: 'Sin cifras no hay propuesta.' }],
  microTasks: [{
    originalTask: 'Revisar números',
    atomicSteps: [{ stepTitle: 'Abrir la hoja de cálculo', durationMinutes: 3, actionableHook: 'Abre el archivo de ventas del mes.' }],
  }],
  ...over,
})

const ids = (rules) => failures(rules).map((rule) => rule.id)

test('en crisis física, un arranque de entrega rompe somatic-override', () => {
  const rules = verifyQuick(quick(), { rawDump: CRISIS })
  assert.ok(ids(rules).includes('somatic-override'))
})

test('en crisis física, un arranque que regula el cuerpo pasa', () => {
  const rules = verifyQuick(quick({ activationHook: 'Sal a la puerta y respira hondo tres veces.' }), { rawDump: CRISIS })
  assert.deepEqual(ids(rules), [])
})

test('sin señales de crisis, la regla ni siquiera se evalúa', () => {
  const rules = verifyQuick(quick(), { rawDump: CALMA })
  assert.ok(!rules.some((rule) => rule.id === 'somatic-override'))
  assert.deepEqual(ids(rules), [])
})

test('el texto fijo de emergencia satisface su propia regla en los dos idiomas', () => {
  for (const [locale, hook] of Object.entries(SAFE_SOMATIC_HOOK)) {
    const rules = verifyQuick(quick({ activationHook: hook }), { rawDump: CRISIS })
    assert.deepEqual(ids(rules), [], `El texto de emergencia en ${locale} no pasa somatic-override`)
  }
})

test('el arranque no puede filtrar nombres internos, gritar, ni pasar de 140 caracteres', () => {
  assert.ok(ids(verifyQuick(quick({ activationHook: 'Mete esto en profesionalProductiva.' }), { rawDump: CALMA })).includes('no-schema-leak'))
  assert.ok(ids(verifyQuick(quick({ singleFocusShield: 'HOY NADA MAS.' }), { rawDump: CALMA })).includes('no-shouting'))
  assert.ok(ids(verifyQuick(quick({ activationHook: 'a'.repeat(141) }), { rawDump: CALMA })).includes('hook-is-one-action'))
  assert.ok(ids(verifyQuick(quick({ activationHook: '**Abre** el borrador.' }), { rawDump: CALMA })).includes('no-markup'))
})

test('el detalle exige un primer paso arrancable y una secuencia sin saltos', () => {
  const bloqueado = detail({ dependencyOrder: [{ step: 1, task: 'Enviar', dependsOn: ['Revisar'], whyThisOrder: 'x' }] })
  assert.ok(ids(verifyDetail(bloqueado, { rawDump: CALMA })).includes('first-step-startable'))

  const conSalto = detail({
    dependencyOrder: [
      { step: 1, task: 'A', dependsOn: [], whyThisOrder: 'x' },
      { step: 3, task: 'B', dependsOn: [], whyThisOrder: 'x' },
    ],
  })
  assert.ok(ids(verifyDetail(conSalto, { rawDump: CALMA })).includes('sequence-numbered'))
  assert.deepEqual(ids(verifyDetail(detail(), { rawDump: CALMA })), [])
})

test('un paso reescrito con información externa sin fuente no es reparable pidiendo de nuevo', () => {
  const ctx = { rawDump: CALMA, groundedStepKeys: new Map([['paso-1', null]]) }
  const rules = verifyDetail(detail(), ctx)
  assert.ok(ids(rules).includes('grounded-has-source'))
  assert.ok(!repairInstruction(rules).includes('sin fuente verificable'))
})

/**
 * La avalancha. AGENTS.md registra «máximo 3 tareas descompuestas» como
 * decisión tomada con datos, pero sólo vivía dentro del prompt. La evidencia
 * de `evaluation-evidence/` muestra corridas con 5 tareas descompuestas y una
 * con 10 micro-pasos en una sola tarea: el modelo no obedece el límite que se
 * le pide. Estas pruebas existen para que ese caso no pueda volver a llegar a
 * la pantalla sin que algo lo frene y lo deje anotado.
 */
const paso = (n) => ({ stepTitle: `Abrir la hoja de cálculo ${n}`, durationMinutes: 3, actionableHook: 'Abre el archivo de ventas del mes.' })
const avalancha = detail({
  microTasks: Array.from({ length: 5 }, (_, t) => ({
    originalTask: `Revisar números ${t + 1}`,
    atomicSteps: Array.from({ length: 10 }, (_, s) => paso(s + 1)),
  })),
})

test('diez micro-pasos en una tarea rompen step-budget y no se reparan pidiendo de nuevo', () => {
  const rules = verifyDetail(avalancha, { rawDump: CALMA })
  assert.ok(ids(rules).includes('step-budget'))
  assert.ok(!failures(rules).find((rule) => rule.id === 'step-budget').repairable)
  assert.ok(!repairInstruction(rules).includes('micro-pasos'))
})

test('descomponer más tareas que el presupuesto queda registrado', () => {
  assert.ok(avalancha.microTasks.length > DECOMPOSITION_BUDGET)
  assert.ok(ids(verifyDetail(avalancha, { rawDump: CALMA })).includes('decomposition-budget'))
})

test('el recorte acota los pasos, conserva las tareas y no deja ninguna vacía', () => {
  const clamped = clampDetail(avalancha)
  assert.ok(clamped.microTasks.every((group) => group.atomicSteps.length === STEP_BUDGET))
  // Tirar una descomposición puede dejar sin pasos justo a la tarea elegida.
  assert.equal(clamped.microTasks.length, avalancha.microTasks.length)
  assert.ok(ids(verifyDetail(clamped, { rawDump: CALMA })).includes('micro-steps-present') === false)
  assert.ok(!ids(verifyDetail(clamped, { rawDump: CALMA })).includes('step-budget'))
})

test('una descomposición dentro del presupuesto pasa intacta, sin copiarla', () => {
  const sano = detail()
  assert.equal(clampDetail(sano), sano)
  assert.ok(!ids(verifyDetail(sano, { rawDump: CALMA })).includes('step-budget'))
  assert.ok(!ids(verifyDetail(sano, { rawDump: CALMA })).includes('decomposition-budget'))
})

test('la instrucción de reparación solo nombra lo que el modelo puede corregir', () => {
  const rules = verifyQuick(quick({ activationHook: 'a'.repeat(141) }), { rawDump: CRISIS })
  const instruction = repairInstruction(rules)
  assert.ok(instruction.includes('regular el cuerpo'))
  assert.ok(instruction.includes('140 caracteres'))
})
