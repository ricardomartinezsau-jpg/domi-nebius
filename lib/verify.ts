import type { TriageOutput } from './triage'

/**
 * Reglas duras que se aplican DESPUÉS del modelo y ANTES de mostrarle algo a la
 * persona. Son determinísticas a propósito: un segundo modelo opinando sobre el
 * primero suena más inteligente, pero no se puede auditar ni explicar, y cuesta
 * otra llamada. Aquí cada rechazo se puede señalar con el dedo.
 *
 * Son crudas y lo sabemos: detectan por palabras, así que dejan pasar casos
 * escritos de forma indirecta. Preferimos una regla que falle de forma
 * predecible y visible a una que falle de forma interesante.
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
  currentTools: string[]
  /** Pasos que fueron reescritos con información de internet, y su fuente. */
  groundedStepKeys: Map<string, { url: string } | null>
}

export function verify(output: TriageOutput, ctx: VerifyContext): Rule[] {
  const rules: Rule[] = []
  const add = (id: string, passed: boolean, detail: string, repairable = true) =>
    rules.push({ id, passed, detail, repairable })

  // 1. La regla que arregla el caso de dificultad documentado: cuando el texto
  // trae señales de crisis fisiológica, el arranque NO puede ser una entrega de
  // trabajo. Primero se regula el cuerpo; el compromiso sigue existiendo después.
  const inDistress = matchesAny(ctx.rawDump, DISTRESS_PATTERNS)
  if (inDistress) {
    add(
      'somatic-override',
      matchesAny(output.momentumMode.activationHook, SOMATIC_PATTERNS),
      'Hay señales de colapso físico en el vaciado: el primer paso debe regular el cuerpo (respirar, agua, aire) antes de cualquier entrega.',
    )
  }

  // 2. Cada tarea grande tiene que quedar realmente partida.
  add(
    'micro-steps-present',
    output.microTasks.every((group) => group.atomicSteps.length > 0),
    'Toda tarea descompuesta debe tener al menos un micro-paso.',
  )

  // 3. El primer paso de la secuencia no puede depender de algo pendiente:
  // si depende, no es un punto de partida, y la persona se vuelve a trabar.
  if (output.dependencyOrder.length) {
    add(
      'first-step-startable',
      output.dependencyOrder[0].dependsOn.length === 0,
      'El primer paso de la secuencia no puede tener prerrequisitos sin resolver.',
    )
    add(
      'sequence-numbered',
      output.dependencyOrder.every((step, index) => step.step === index + 1),
      'La secuencia debe ir numerada de 1 a N sin saltos.',
    )
  }

  // 4. Cada micro-paso trae un primer movimiento concreto: sin eso, vuelve a
  // ser una instrucción abstracta, que es justo lo que paraliza.
  add(
    'hooks-concrete',
    output.microTasks.every((group) => group.atomicSteps.every((step) => step.actionableHook.trim().length >= 10)),
    'Cada micro-paso necesita un primer clic o movimiento concreto.',
  )

  // 5. Nada traído de internet se muestra sin fuente. Esta no es reparable
  // pidiéndole otra vez al modelo: si no hay fuente, el dato se cae.
  const unsourced = [...ctx.groundedStepKeys.entries()].filter(([, source]) => !source?.url)
  add(
    'grounded-has-source',
    unsourced.length === 0,
    `Hay ${unsourced.length} paso(s) reescrito(s) con información externa sin fuente verificable.`,
    false,
  )

  // 6. No recomendar una herramienta que la persona ya dijo que usa: rompe la
  // única ilusión que sostiene el producto, la de que la conoce.
  if (ctx.currentTools.length) {
    const allText = output.microTasks
      .flatMap((group) => group.atomicSteps.map((step) => `${step.stepTitle} ${step.actionableHook}`))
      .join(' ')
      .toLowerCase()
    const redundant = ctx.currentTools.filter((tool) => {
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

export const failures = (rules: Rule[]) => rules.filter((rule) => !rule.passed)

/** Texto que se le devuelve al modelo en el único intento de reparación. */
export function repairInstruction(rules: Rule[]): string {
  const broken = failures(rules).filter((rule) => rule.repairable)
  if (!broken.length) return ''
  return [
    'Tu respuesta anterior incumplió estas reglas. Corrígelas sin cambiar nada más:',
    ...broken.map((rule) => `- ${rule.detail}`),
  ].join('\n')
}
