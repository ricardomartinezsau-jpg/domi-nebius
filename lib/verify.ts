// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import type { DetailOutput, QuickOutput, TriageOutput } from './triage'

/**
 * Reglas duras que se aplican DESPUÉS del modelo y ANTES de mostrarle algo a la
 * persona. Son determinísticas a propósito: un segundo modelo opinando sobre el
 * primero suena más inteligente, pero no se puede auditar ni explicar, y cuesta
 * otra llamada. Aquí cada rechazo se puede señalar con el dedo.
 *
 * Son crudas y lo sabemos: detectan por palabras, así que dejan pasar casos
 * escritos de forma indirecta. Preferimos una regla que falle de forma
 * predecible y visible a una que falle de forma interesante.
 *
 * Se aplican por fase porque el producto responde por fases: la regla del
 * arranque no puede esperar al plan completo, que es justo lo que la persona
 * todavía no tiene delante.
 */

export type Rule = { id: string; passed: boolean; detail: string; repairable: boolean }

/** Señales de que el cuerpo de la persona está en crisis, no solo su agenda. */
const DISTRESS_PATTERNS = [
  /no puedo respirar/i, /me cuesta respirar/i, /pecho apretado/i,
  /par[áa]lisis (total|completa)/i, /ataque de p[áa]nico/i, /colapso/i,
  /no doy m[áa]s/i, /taquicardia/i, /me tiembla/i, /llevo (dos|tres|\d+) d[íi]as sin dormir/i,
  /can't breathe/i, /panic attack/i, /shutting down/i, /can't stop shaking/i,
]

/** Acciones que regulan el sistema nervioso antes de exigirle algo. */
const SOMATIC_PATTERNS = [
  /respir/i, /agua/i, /caminar/i, /camina/i, /estirar/i, /sal[ií]r? (a|al)/i,
  /aire/i, /pausa/i, /acost/i, /sent[aá]rte/i, /breath/i, /water/i, /walk/i, /stretch/i,
]

const matchesAny = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text))

export type VerifyContext = {
  rawDump: string
  /** Herramientas que la persona ya dijo que usa. Vacío mientras no haya perfil. */
  currentTools?: string[]
  /** Pasos que fueron reescritos con información de internet, y su fuente. */
  groundedStepKeys?: Map<string, { url: string } | null>
}

const TRAY_KEYS = /personalBienestar|profesionalProductiva|familiarDomestica|socialComunitaria/

/**
 * Presupuesto de descomposición. AGENTS.md registra «máximo 3 tareas
 * descompuestas» como decisión tomada con datos, pero hasta aquí sólo vivía
 * como una frase dentro del prompt: ni el esquema ni una regla la sostenían.
 * La evidencia grabada en `evaluation-evidence/` muestra corridas con 5 tareas
 * descompuestas y una con 10 micro-pasos en una sola tarea. Pedirle algo al
 * modelo no es una garantía; comprobarlo sí.
 */
export const DECOMPOSITION_BUDGET = 3
/**
 * Tope de micro-pasos por tarea. Es el único que la persona mira de frente:
 * en Dominio los pasos de la tarea elegida se pintan todos. Diez casillas para
 * una sola tarea reproducen exactamente la avalancha de la que vino huyendo,
 * y «hazla más pequeña» tiene que acercar el siguiente movimiento, no alargar
 * la lista. Medido contra la evidencia grabada: lo observado va de 1 a 10 con
 * el grueso entre 3 y 5, así que este tope recorta el caso desbocado y deja
 * intacto todo lo demás.
 */
export const STEP_BUDGET = 5

/**
 * Recorte determinístico, no una segunda llamada al modelo. Se aplica DESPUÉS
 * de verificar, para que el informe registre que la regla se rompió y aun así
 * la persona reciba una lista acotada.
 *
 * Recorta pasos, nunca tareas: los pasos vienen ordenados y la cola es trabajo
 * posterior, mientras que tirar la descomposición de una tarea puede dejar sin
 * pasos justo a la que la persona eligió. Esa se reporta y se conserva.
 */
export function clampDetail(detail: DetailOutput): DetailOutput {
  if (detail.microTasks.every((group) => group.atomicSteps.length <= STEP_BUDGET)) return detail
  return { ...detail, microTasks: detail.microTasks.map((group) => group.atomicSteps.length <= STEP_BUDGET ? group : { ...group, atomicSteps: group.atomicSteps.slice(0, STEP_BUDGET) }) }
}

/**
 * Higiene del texto que la persona lee. Los tres defectos aparecieron en
 * pruebas reales y los tres delatan la costura de la máquina.
 */
function textRules(userFacing: string[]): Rule[] {
  const add = (id: string, passed: boolean, detail: string): Rule => ({ id, passed, detail, repairable: true })
  return [
    add('no-schema-leak', !userFacing.some((text) => TRAY_KEYS.test(text)), 'El texto visible no puede contener los nombres internos de las bandejas.'),
    add('no-markup', !userFacing.some((text) => /\*|_{2,}|#{1,6}\s/.test(text)), 'El texto visible no lleva asteriscos ni marcas de formato: se lee tal cual.'),
    add('no-shouting', !userFacing.some((text) => /\b[A-ZÁÉÍÓÚÑ]{4,}\b/.test(text)), 'Nada en mayúsculas sostenidas: a alguien saturado le suena a grito.'),
  ]
}

/**
 * Fase rápida. Es la que corre contra el reloj: la persona está mirando la
 * pantalla. La regla `somatic-override` vive aquí porque el arranque es lo
 * único que ve antes de actuar.
 */
export function verifyQuick(quick: QuickOutput, ctx: VerifyContext): Rule[] {
  const rules: Rule[] = []
  const add = (id: string, passed: boolean, detail: string, repairable = true) =>
    rules.push({ id, passed, detail, repairable })

  // Cuando el texto trae señales de crisis fisiológica, el arranque NO puede
  // ser una entrega de trabajo. Primero se regula el cuerpo; el compromiso
  // sigue existiendo después.
  if (matchesAny(ctx.rawDump, DISTRESS_PATTERNS)) {
    add(
      'somatic-override',
      matchesAny(quick.momentumMode.activationHook, SOMATIC_PATTERNS),
      'Hay señales de colapso físico en el vaciado: el primer paso debe regular el cuerpo (respirar, agua, aire) antes de cualquier entrega.',
    )
  }

  rules.push(...textRules([
    quick.momentumMode.activationHook,
    quick.momentumMode.singleFocusShield,
    ...quick.momentumMode.antiDopamineTraps.flatMap((trap) => [trap.activity, trap.warning]),
  ]))

  add('hook-is-one-action', quick.momentumMode.activationHook.trim().length <= 140, 'El arranque es una sola frase de menos de 140 caracteres.')
  add('hook-not-empty', quick.momentumMode.activationHook.trim().length > 0, 'El arranque no puede llegar vacío.', false)

  return rules
}

/**
 * Fase de detalle. Llega cuando la persona ya arrancó, así que aquí sí se puede
 * pagar una reparación sin dejarla esperando frente a una pantalla en blanco.
 */
export function verifyDetail(detail: DetailOutput, ctx: VerifyContext): Rule[] {
  const rules: Rule[] = []
  const add = (id: string, passed: boolean, message: string, repairable = true) =>
    rules.push({ id, passed, detail: message, repairable })

  rules.push(...textRules(detail.microTasks.flatMap((group) => group.atomicSteps.flatMap((step) => [step.stepTitle, step.actionableHook]))))

  // Cada tarea grande tiene que quedar realmente partida.
  add(
    'micro-steps-present',
    detail.microTasks.every((group) => group.atomicSteps.length > 0),
    'Toda tarea descompuesta debe tener al menos un micro-paso.',
  )

  // Los dos presupuestos de descomposición. Ninguno es reparable: el recorte
  // determinístico de `clampDetail` ya acota lo que se muestra, y volver a
  // pedírselo al modelo cuesta segundos sin garantizar que obedezca —la
  // evidencia grabada muestra que no obedece el límite que ya trae el prompt.
  const overflowing = detail.microTasks.filter((group) => group.atomicSteps.length > STEP_BUDGET)
  add(
    'step-budget',
    overflowing.length === 0,
    `Ninguna tarea puede traer más de ${STEP_BUDGET} micro-pasos; hay ${overflowing.length} que se pasa(n). Se recortan antes de mostrarlos.`,
    false,
  )
  add(
    'decomposition-budget',
    detail.microTasks.length <= DECOMPOSITION_BUDGET,
    `Se descompusieron ${detail.microTasks.length} tareas y el presupuesto es ${DECOMPOSITION_BUDGET}. Se conservan, pero el límite documentado se rompió.`,
    false,
  )

  // El primer paso de la secuencia no puede depender de algo pendiente: si
  // depende, no es un punto de partida, y la persona se vuelve a trabar.
  if (detail.dependencyOrder.length) {
    add(
      'first-step-startable',
      detail.dependencyOrder[0].dependsOn.length === 0,
      'El primer paso de la secuencia no puede tener prerrequisitos sin resolver.',
    )
    add(
      'sequence-numbered',
      detail.dependencyOrder.every((step, index) => step.step === index + 1),
      'La secuencia debe ir numerada de 1 a N sin saltos.',
    )
  }

  // Cada micro-paso trae un primer movimiento concreto: sin eso, vuelve a ser
  // una instrucción abstracta, que es justo lo que paraliza.
  add(
    'hooks-concrete',
    detail.microTasks.every((group) => group.atomicSteps.every((step) => step.actionableHook.trim().length >= 10)),
    'Cada micro-paso necesita un primer clic o movimiento concreto.',
  )

  // Nada traído de internet se muestra sin fuente. Esta no es reparable
  // pidiéndole otra vez al modelo: si no hay fuente, el dato se cae.
  const unsourced = [...(ctx.groundedStepKeys ?? new Map()).entries()].filter(([, source]) => !source?.url)
  add(
    'grounded-has-source',
    unsourced.length === 0,
    `Hay ${unsourced.length} paso(s) reescrito(s) con información externa sin fuente verificable.`,
    false,
  )

  // No recomendar una herramienta que la persona ya dijo que usa: rompe la
  // única ilusión que sostiene el producto, la de que la conoce.
  const currentTools = ctx.currentTools ?? []
  if (currentTools.length) {
    const allText = detail.microTasks
      .flatMap((group) => group.atomicSteps.map((step) => `${step.stepTitle} ${step.actionableHook}`))
      .join(' ')
      .toLowerCase()
    const redundant = currentTools.filter((tool) => {
      const normalized = tool.trim().toLowerCase()
      return normalized.length > 2 && new RegExp(`\\b(instala|descarga|crea una cuenta en|prueba)\\b[^.]*${normalized}`, 'i').test(allText)
    })
    add(
      'no-redundant-tools',
      redundant.length === 0,
      `Se está proponiendo adoptar una herramienta que la persona ya usa: ${redundant.join(', ')}.`,
    )
  }

  return rules
}

/** Las dos fases juntas: es lo que evalúa `tests/eval.mjs` sobre una corrida completa. */
export function verify(output: TriageOutput, ctx: VerifyContext): Rule[] {
  return [...verifyQuick(output, ctx), ...verifyDetail(output, ctx)]
}

export const failures = (rules: Rule[]) => rules.filter((rule) => !rule.passed)

/**
 * Último recurso cuando el modelo insiste en un arranque inseguro. No es una
 * frase "generada": está escrita aquí, cualquiera puede leerla, y por eso la
 * garantía no depende de que el modelo obedezca.
 */
export const SAFE_SOMATIC_HOOK: Record<'es' | 'en', string> = {
  es: 'Antes de nada: tres respiraciones lentas y un vaso de agua. Lo demás sigue ahí en cinco minutos.',
  en: 'Before anything else: three slow breaths and a glass of water. The rest will still be there in five minutes.',
}

/** Texto que se le devuelve al modelo en el único intento de reparación. */
export function repairInstruction(rules: Rule[]): string {
  const broken = failures(rules).filter((rule) => rule.repairable)
  if (!broken.length) return ''
  return [
    'Tu respuesta anterior incumplió estas reglas. Corrígelas sin cambiar nada más:',
    ...broken.map((rule) => `- ${rule.detail}`),
  ].join('\n')
}
