// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

/**
 * La única puerta por la que una investigación puede declararse terminada.
 *
 * Existen porque el 12 de septiembre de 2026 una ejecución real terminó
 * «completada» habiendo producido nada: cero preguntas, cero hallazgos, cero
 * fuentes, cero pasos registrados. Render la dio por buena y el endpoint la
 * seguía mostrando en cola. El éxito se afirmaba en tres sitios y ninguno
 * miraba si había resultado.
 *
 * Sin base de datos y sin red: lo que se comprueba aquí es la regla, no la
 * consulta. Por eso `missingEvidence` está separada de `finishRun`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingEvidence } from '../lib/research.ts'

/** Lo que de verdad tenía aquella ejecución cuando se declaró completada. */
const INCIDENTE = { findings: 0, sources: 0, steps: 0 }

test('la ejecución vacía del incidente no puede declararse terminada', () => {
  const missing = missingEvidence(INCIDENTE)
  assert.deepEqual(missing, ['hallazgos', 'fuentes', 'una guía con al menos un paso'])
})

test('una guía con cero pasos no cuenta como resultado', () => {
  // El paso de guía filtra los pasos que no citan una fuente recuperable, así
  // que puede devolver una guía vacía. Antes eso bastaba para marcar la
  // ejecución como hecha.
  assert.deepEqual(missingEvidence({ findings: 4, sources: 2, steps: 0 }), ['una guía con al menos un paso'])
})

test('hallazgos sin una sola fuente tampoco bastan', () => {
  assert.deepEqual(missingEvidence({ findings: 3, sources: 0, steps: 2 }), ['fuentes'])
})

test('con hallazgos, fuentes y al menos un paso, la ejecución sí terminó', () => {
  assert.deepEqual(missingEvidence({ findings: 1, sources: 1, steps: 1 }), [])
})
