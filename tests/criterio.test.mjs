/**
 * Las pruebas que protegen el criterio. Sin red y sin modelo: corren en un segundo.
 * Si una de estas falla, Domi dejó de ser un criterio y pasó a ser una sugerencia.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aplicarCriterio, ARRANQUE_SEGURO, TOPE_COSAS, TOPE_PASOS } from "../lib/criterio.ts"

const CRISIS = 'Tengo que cerrar el trimestre y no puedo respirar bien, me quedo mirando la pantalla.'
const CALMA = 'Tengo que mandar la propuesta y comprar despensa.'

test('ante colapso fisico, Domi sustituye el arranque aunque la propuesta sea sensata', () => {
  const r = aplicarCriterio({ situacion: CRISIS, propuesta: [{ titulo: 'Cerrar el trimestre', primer_movimiento: 'Abre el documento y escribe el titulo' }] })
  assert.equal(r.siguiente_movimiento, ARRANQUE_SEGURO)
  assert.ok(r.criterio_aplicado.arranque_sustituido)
  assert.ok(r.criterio_aplicado.rotas.includes('anulacion-por-colapso'))
})

test('si el arranque ya regula el cuerpo, no se sustituye', () => {
  const r = aplicarCriterio({ situacion: CRISIS, propuesta: [{ titulo: 'Parar', primer_movimiento: 'Sal a la puerta y respira hondo tres veces' }] })
  assert.ok(!r.criterio_aplicado.arranque_sustituido)
  assert.ok(!r.criterio_aplicado.rotas.includes('anulacion-por-colapso'))
})

test('sin senales de crisis la regla no se aplica', () => {
  const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Mandar la propuesta', primer_movimiento: 'Abre el borrador del correo' }] })
  assert.ok(!r.criterio_aplicado.rotas.includes('anulacion-por-colapso'))
  assert.equal(r.siguiente_movimiento, 'Abre el borrador del correo')
})

test('el techo recorta la avalancha y lo deja anotado', () => {
  const muchas = Array.from({ length: 6 }, (_, i) => ({ titulo: `Cosa ${i + 1}`, primer_movimiento: 'Abre el archivo de ventas', pasos: Array.from({ length: 9 }, (_, j) => `Paso ${j + 1}`) }))
  const r = aplicarCriterio({ situacion: CALMA, propuesta: muchas })
  assert.equal(r.propuesta_corregida.length, TOPE_COSAS)
  assert.ok(r.propuesta_corregida.every((c) => c.pasos.length === TOPE_PASOS))
  assert.ok(r.criterio_aplicado.rotas.includes('techo-de-cosas'))
  assert.ok(r.criterio_aplicado.rotas.includes('techo-de-pasos'))
})

test('un arranque que no cabe en una linea se recorta', () => {
  const largo = 'Abre el documento y ' + 'revisa cada apartado con calma '.repeat(8)
  const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Cerrar', primer_movimiento: largo }] })
  assert.ok(r.siguiente_movimiento.length <= 140)
  assert.ok(r.criterio_aplicado.rotas.includes('arranque-de-una-linea'))
})

test('una propuesta que cumple pasa sin una sola correccion', () => {
  const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Mandar la propuesta', primer_movimiento: 'Abre el borrador del correo', pasos: ['Abrir el borrador', 'Revisar el precio'] }] })
  assert.deepEqual(r.criterio_aplicado.rotas, [])
  assert.match(r.criterio_aplicado.resumen, /sin cambios/)
})

/* --- Criterio añadido desde el prototipo de andamiaje cognitivo --- */

test('cero deuda: contar lo atrasado rompe la regla', () => {
  const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Ponerte al dia', primer_movimiento: 'Abre los 40 mensajes sin leer del canal' }] })
  assert.ok(r.criterio_aplicado.rotas.includes('cero-deuda'))
})

test('tono: deberias, urgente y tienes que estan prohibidos', () => {
  for (const frase of ['Deberias abrir el documento ya', 'Abre el documento, es urgente', 'Tienes que mandar el correo']) {
    const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Cerrar', primer_movimiento: frase }] })
    assert.ok(r.criterio_aplicado.rotas.includes('sin-urgencia-impuesta'), `no detecto: ${frase}`)
  }
})

test('la regla de dos minutos: un arranque analitico no sirve', () => {
  const malo = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Cierre', primer_movimiento: 'Analiza los numeros del trimestre' }] })
  assert.ok(malo.criterio_aplicado.rotas.includes('primer-movimiento-mecanico'))
  const bueno = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Cierre', primer_movimiento: 'Abre la hoja de numeros del trimestre' }] })
  assert.ok(!bueno.criterio_aplicado.rotas.includes('primer-movimiento-mecanico'))
})

test('lee los cuatro estados y admite no saber', () => {
  const casos = [
    ['Me siento y no puedo respirar bien', 'colapso_fisico'],
    ['Tengo mil cosas y no me da la vida', 'sobrecarga'],
    ['Se lo que tengo que hacer, pero no puedo arrancar', 'bloqueo_iniciacion'],
    ['Llevo semanas posponiendo esto, me da pereza', 'friccion_evitacion'],
    ['Manana tengo una reunion a las diez', 'sin_senal_clara'],
  ]
  for (const [texto, esperado] of casos) {
    assert.equal(aplicarCriterio({ situacion: texto }).estado_cognitivo, esperado, `fallo con: ${texto}`)
  }
})

test('el cuerpo manda: el colapso gana sobre cualquier otra senal', () => {
  const r = aplicarCriterio({ situacion: 'Tengo mil cosas, llevo semanas posponiendolo y no puedo respirar bien.' })
  assert.equal(r.estado_cognitivo, 'colapso_fisico')
})

test('el boton no pasa de tres palabras', () => {
  const r = aplicarCriterio({ situacion: CALMA, propuesta: [{ titulo: 'Cerrar', primer_movimiento: 'Abre el borrador del correo y ponle el asunto' }] })
  assert.ok(r.copy_boton.split(/\s+/).length <= 3)
  const crisis = aplicarCriterio({ situacion: CRISIS, propuesta: [{ titulo: 'Cerrar', primer_movimiento: 'Abre el documento' }] })
  assert.equal(crisis.copy_boton, 'Respirar primero')
})
