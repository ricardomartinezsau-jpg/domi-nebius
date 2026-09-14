import { z } from 'zod'
import { generateStructured } from './nebius'

/**
 * El contrato está partido en dos a propósito, y la razón es medida, no
 * estética: pedir las cuatro secciones en una sola respuesta hacía que los
 * cuatro modelos occidentales probados tardaran entre 9 y 20 segundos, y que
 * uno se quedara sin espacio a media frase. Veinte segundos frente a una
 * pantalla es exactamente donde se pierde la persona que vinimos a ayudar.
 *
 * Fase 1 (rápida): dónde cae cada cosa y por dónde empezar AHORA.
 * Fase 2 (detalle): la secuencia completa y los micro-pasos.
 *
 * La persona actúa con la fase 1; la fase 2 llega mientras ya está empezando.
 */

const TRAYS = z
  .object({
    personalBienestar: z.array(z.string()).describe('Salud física/mental, descanso, ocio propio, autocuidado.'),
    profesionalProductiva: z.array(z.string()).describe('Negocio, trabajo, facturación, entregables a clientes.'),
    familiarDomestica: z.array(z.string()).describe('Hogar, pareja, familia, mantenimiento y logística.'),
    socialComunitaria: z.array(z.string()).describe('Amigos, red de contactos, vecindario y comunidad.'),
  })
  .describe('Distribución de todos los ítems del vaciado en las 4 bandejas fundamentales de vida.')

const MOMENTUM = z
  .object({
    activationHook: z.string().describe('Micro-acción inmediata de 2 a 5 minutos, ridículamente fácil, para romper la inercia.'),
    cognitiveLoadLevel: z.enum(['baja', 'media', 'alta']).describe('Nivel de saturación mental detectado en el vaciado.'),
    antiDopamineTraps: z
      .array(
        z.object({
          activity: z.string(),
          warning: z.string().describe('Explicación empática de por qué drena energía sin aportar valor en sus propios términos.'),
        }),
      )
      .describe('Trampas de procrastinación productiva detectadas.'),
    singleFocusShield: z.string().describe('Regla de foco: qué ignorar conscientemente hoy.'),
  })
  .describe('Modo Momentum: arranque de baja fricción para mentes dispersas / TDAH.')

/** Fase 1: lo que la persona necesita para moverse en los próximos 5 minutos. */
export const quickSchema = z.object({ trayDispatch: TRAYS, momentumMode: MOMENTUM })

/** Fase 2: el plan completo, que llega cuando ya arrancó. */
export const detailSchema = z.object({
  dependencyOrder: z
    .array(
      z.object({
        step: z.number().int(),
        task: z.string(),
        dependsOn: z.array(z.string()).describe('Prerrequisitos indispensables antes de ejecutar esta.'),
        whyThisOrder: z.string().describe('Razón secuencial lógica para evitar bloqueos.'),
      }),
    )
    .describe('Secuencia lógica ordenada por dependencias.'),
  microTasks: z
    .array(
      z.object({
        originalTask: z.string(),
        atomicSteps: z.array(
          z.object({
            stepTitle: z.string().describe('Micro-acción de 2 a 10 minutos.'),
            durationMinutes: z.number().int().min(2).max(10),
            actionableHook: z.string().describe('El primer clic o movimiento físico concreto.'),
          }),
        ),
      }),
    )
    .describe('Descomposición de tareas intimidantes en micro-pasos atómicos.'),
})

/** El objeto completo, que es lo que se evalúa y lo que se guarda. */
export const triageSchema = quickSchema.merge(detailSchema)

export type QuickOutput = z.infer<typeof quickSchema>
export type DetailOutput = z.infer<typeof detailSchema>
export type TriageOutput = z.infer<typeof triageSchema>

export type TriageContext = {
  rawDump: string
  today: string
  locale?: 'es' | 'en'
  /** Tareas parecidas de vaciados anteriores, ya recuperadas de la memoria. */
  recalled?: { title: string; status: string; timesResurfaced: number }[]
}

const BASE_ES = `Eres el motor de triage de Domi. Recibes un vaciado mental caótico de una persona con disfunción ejecutiva / TDAH. Hablas directo, empático y sin reproches. No inventes tareas que la persona no mencionó.`
const BASE_EN = `You are Domi's triage engine. You receive a chaotic brain dump from someone with executive dysfunction / ADHD. Speak directly and empathetically, without reproach. Never invent tasks the person did not mention.`

const QUICK_ES = `${BASE_ES}

Devuelve SOLO dos cosas:
1. BANDEJAS (trayDispatch): clasifica y formula cada pendiente en personalBienestar, profesionalProductiva, familiarDomestica o socialComunitaria.
   - FORMULA ACCIONES CONCRETAS: No copies quejas caóticas, desahogos ni errores ortográficos tal cual. Transforma cada pensamiento en una tarea concreta, accionable y alcanzable con buena ortografía. Por ejemplo, si escribe "dejo en visto a medio mundo", conviértelo en "Revisar mensajes pendientes y contestar a los 3 primeros"; si escribe "el desastre de la cocina", pon "Lavar los platos acumulados".
   - Cada tarea debe iniciar con un verbo de acción claro, ser breve y factible.
   - No inventes pendientes que la persona no mencionó: extrae y formula lo que realmente necesita hacerse a partir de lo que expresó.
2. MOMENTUM (momentumMode): un activationHook de 2 a 5 minutos ridículamente fácil; las trampas de dopamina falsa que detectes, sin culpar; y un singleFocusShield claro.

REGLA INNEGOCIABLE: si el vaciado trae señales de colapso físico (no poder respirar, pánico, temblor, parálisis total), el activationHook DEBE ser una acción que regule el cuerpo —respirar, tomar agua, salir a tomar aire— antes que cualquier entrega de trabajo. El compromiso sigue existiendo después; la persona no.

CÓMO SE ESCRIBE:
- El activationHook es UNA sola frase de menos de 140 caracteres. Una acción, no un discurso.
- Escribe en minúsculas normales. Nunca uses MAYÚSCULAS para enfatizar: a alguien saturado le suena a grito.
- Nada de asteriscos, guiones bajos ni formato: es texto que se lee tal cual.
- Nunca escribas los nombres internos de las bandejas (personalBienestar, profesionalProductiva, familiarDomestica, socialComunitaria). Di "lo personal", "lo del trabajo", "lo de casa", "lo social".
- Si mencionas minutos en el arranque, que sean entre 2 y 5. No prometas bloques de 15.`

const QUICK_EN = `${BASE_EN}

Return ONLY two things:
1. TRAYS (trayDispatch): classify and formulate each item into personalBienestar, profesionalProductiva, familiarDomestica or socialComunitaria.
   - FORMULATE CONCRETE ACTIONS: Do not copy raw chaotic text, vague vents, or typos verbatim. Transform each thought into a concrete, doable, well-phrased actionable task with proper grammar and spelling. For example, if the person writes "leaving everyone on read", turn it into "Check pending messages and reply to the first 3"; if they write "kitchen is a disaster", turn it into "Wash accumulated dishes".
   - Each task must start with a clear action verb, be concise, and realistic.
   - Never invent tasks the person did not mention: extract and formulate what actually needs doing from what they expressed.
2. MOMENTUM (momentumMode): a ridiculously easy 2-5 minute activationHook; the fake-dopamine traps you detect, without blame; and a clear singleFocusShield.

NON-NEGOTIABLE: if the dump shows signs of physical collapse (can't breathe, panic, shaking, total paralysis), the activationHook MUST be a body-regulating action —breathe, drink water, step outside— before any work delivery. The commitment survives; the person may not.

HOW IT IS WRITTEN:
- The activationHook is ONE sentence under 140 characters. An action, not a speech.
- Normal sentence case. Never use ALL CAPS for emphasis: to someone overwhelmed it reads as shouting.
- No asterisks, underscores or markup: this text is read exactly as written.
- Never write the internal tray identifiers (personalBienestar, profesionalProductiva, familiarDomestica, socialComunitaria). Say "the personal stuff", "work", "home", "social".
- If you mention minutes in the hook, keep them between 2 and 5. Never promise 15-minute blocks.`

const DETAIL_ES = `${BASE_ES}

Ya se decidió el reparto en bandejas y el arranque. Ahora devuelve SOLO:
1. DEPENDENCIAS (dependencyOrder): detecta qué bloquea a qué y numera de 1 a N usando los títulos de las tareas ya formuladas. El paso 1 no puede depender de nada pendiente.
2. MICRO-TAREAS (microTasks): parte en pasos de 2 a 10 minutos, cada uno con un actionableHook que sea el primer movimiento físico o de pantalla concreto.

LÍMITE ESTRICTO: descompón como MÁXIMO 3 tareas, las que más destraban el resto. Entregar diez tareas descompuestas a la vez reproduce la avalancha que esta persona vino a evitar. Las demás quedan listadas en las bandejas, sin descomponer.`

const DETAIL_EN = `${BASE_EN}

Tray dispatch and the starting hook are already decided. Now return ONLY:
1. DEPENDENCIES (dependencyOrder): detect what blocks what and number 1..N using the formulated task titles. Step 1 cannot depend on anything pending.
2. MICRO-TASKS (microTasks): break into 2-10 minute steps, each with an actionableHook that is the concrete first physical or on-screen move.

HARD LIMIT: decompose AT MOST 3 tasks, the ones that unblock the most. Handing over ten decomposed tasks at once recreates the avalanche this person came to escape. The rest stay listed in the trays, undecomposed.`

function memoryBlock(ctx: TriageContext, isEn: boolean): string {
  if (!ctx.recalled?.length) return ''
  const lines = ctx.recalled.map(
    (task) => `- ${task.title} [${task.status}${task.timesResurfaced > 1 ? `, ha reaparecido ${task.timesResurfaced} veces sin arrancar` : ''}]`,
  )
  return isEn
    ? `\n\nFROM THEIR HISTORY (do not repeat what is done; if something keeps resurfacing, name it kindly as a possible avoidance):\n${lines.join('\n')}`
    : `\n\nDE SU HISTORIAL (no repitas lo hecho; si algo reaparece una y otra vez, nómbralo con amabilidad como posible evitación):\n${lines.join('\n')}`
}

function userPrompt(ctx: TriageContext, isEn: boolean): string {
  const head = isEn ? `TODAY'S DATE: ${ctx.today}` : `FECHA DE HOY: ${ctx.today}`
  const body = isEn ? 'PERSON\'S BRAIN DUMP:' : 'VACIADO MENTAL DE LA PERSONA:'
  return `${head}${memoryBlock(ctx, isEn)}\n\n${body}\n"""\n${ctx.rawDump}\n"""`
}

/**
 * `repair` es el único reintento que se permite: el texto que devuelve
 * `lib/verify.ts` cuando una regla dura falló. No cambia el contrato ni el
 * prompt base, solo añade la corrección pedida.
 */
export type TriageOptions = { modelId?: string; repair?: string }

const repairBlock = (repair?: string) => (repair ? `\n\n${repair}` : '')

export async function runQuickTriage(ctx: TriageContext, opts: TriageOptions = {}) {
  const isEn = ctx.locale === 'en'
  return generateStructured({
    system: isEn ? QUICK_EN : QUICK_ES,
    prompt: userPrompt(ctx, isEn) + repairBlock(opts.repair),
    schema: quickSchema,
    modelId: opts.modelId,
  })
}

export async function runDetailTriage(ctx: TriageContext, quick: QuickOutput, opts: TriageOptions = {}) {
  const isEn = ctx.locale === 'en'
  const decided = isEn
    ? `\n\nALREADY DECIDED — starting hook: ${quick.momentumMode.activationHook}`
    : `\n\nYA DECIDIDO — arranque: ${quick.momentumMode.activationHook}`
  return generateStructured({
    system: isEn ? DETAIL_EN : DETAIL_ES,
    prompt: userPrompt(ctx, isEn) + decided + repairBlock(opts.repair),
    schema: detailSchema,
    modelId: opts.modelId,
  })
}
