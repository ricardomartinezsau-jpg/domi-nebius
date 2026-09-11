import { z } from 'zod'
import { generateStructured } from './nebius'

/**
 * Contrato mínimo del triage: solo las 4 superpotencias que este MVP
 * demuestra y mide. Se dejó fuera a propósito todo lo que en el producto
 * completo depende de un historial persistente (primer dominó vs. tareas
 * abiertas, duplicados, bloqueos, recordatorios): este servicio no guarda
 * estado entre peticiones, así que evaluar esos campos aquí sería una
 * garantía falsa.
 */
export const triageSchema = z.object({
  trayDispatch: z
    .object({
      personalBienestar: z.array(z.string()).describe('Salud física/mental, descanso, ocio propio, autocuidado.'),
      profesionalProductiva: z.array(z.string()).describe('Negocio, trabajo, facturación, entregables a clientes.'),
      familiarDomestica: z.array(z.string()).describe('Hogar, pareja, familia, mantenimiento y logística.'),
      socialComunitaria: z.array(z.string()).describe('Amigos, red de contactos, vecindario y comunidad.'),
    })
    .describe('Distribución automática de todos los ítems del vaciado en las 4 bandejas fundamentales de vida.'),
  dependencyOrder: z
    .array(
      z.object({
        step: z.number().int(),
        task: z.string(),
        dependsOn: z.array(z.string()).describe('Tareas o condiciones previas indispensables antes de ejecutar esta.'),
        whyThisOrder: z.string().describe('Razón secuencial lógica para evitar bloqueos.'),
      }),
    )
    .describe('Secuencia lógica ordenada por dependencias para evitar fricción y parálisis.'),
  microTasks: z
    .array(
      z.object({
        originalTask: z.string(),
        atomicSteps: z.array(
          z.object({
            stepTitle: z.string().describe('Micro-acción de 2 a 10 minutos.'),
            durationMinutes: z.number().int().min(2).max(10),
            actionableHook: z.string().describe('El primer clic o movimiento físico concreto para romper la parálisis por análisis.'),
          }),
        ),
      }),
    )
    .describe('Descomposición de tareas intimidantes en micro-pasos atómicos (<10 min).'),
  momentumMode: z
    .object({
      activationHook: z.string().describe('Micro-acción inmediata de 2 a 5 minutos ridículamente fácil para romper la inercia.'),
      cognitiveLoadLevel: z.enum(['baja', 'media', 'alta']).describe('Nivel de saturación mental detectado en el vaciado.'),
      antiDopamineTraps: z
        .array(
          z.object({
            activity: z.string(),
            warning: z.string().describe('Explicación empática de por qué esto drena energía sin aportar valor a sus propios términos.'),
          }),
        )
        .describe('Trampas de procrastinación productiva detectadas (organizar Notion, refactors cosméticos, etc.).'),
      singleFocusShield: z.string().describe('Regla de foco extremo: qué ignorar conscientemente hoy para no dispersar energía.'),
    })
    .describe('Modo Momentum: arranque de baja fricción para mentes dispersas / TDAH.'),
})

export type TriageOutput = z.infer<typeof triageSchema>

export type TriageContext = { rawDump: string; today: string; locale?: 'es' | 'en' }

const SYSTEM_ES = `Eres el motor de triage de Domi. Recibes un vaciado mental caótico de una persona con disfunción ejecutiva / TDAH y devuelves una estructura que le permita empezar sin fricción. No conoces su historial: trabajas solo con lo que escribió ahora.

Reglas:
1. BANDEJAS (trayDispatch): clasifica cada ítem del vaciado en personalBienestar, profesionalProductiva, familiarDomestica o socialComunitaria.
2. ORDEN DE DEPENDENCIAS (dependencyOrder): detecta qué bloquea a qué y ordena la secuencia; explica en whyThisOrder por qué va en ese lugar.
3. MICRO-TAREAS (microTasks): descompón cualquier tarea intimidante en pasos de 2 a 10 minutos, cada uno con un actionableHook: el primer movimiento físico o de pantalla concreto.
4. MODO MOMENTUM (momentumMode): da un activationHook de 2 a 5 minutos ridículamente fácil, identifica actividades de cueva / trampas de dopamina falsa en antiDopamineTraps (sin culpar a la persona) y define un singleFocusShield claro.
5. Responde en español, tono directo, empático y humano. No inventes tareas que la persona no mencionó. No repitas literalmente el mismo texto entre bandejas y pasos.`

const SYSTEM_EN = `You are Domi's triage engine. You receive a chaotic brain dump from someone with executive dysfunction / ADHD and return a structure that lets them start with zero friction. You know nothing about their history: work only with what they wrote now.

Rules:
1. TRAYS (trayDispatch): classify every item into personalBienestar, profesionalProductiva, familiarDomestica or socialComunitaria.
2. DEPENDENCY ORDER (dependencyOrder): detect what blocks what and sequence it; explain in whyThisOrder why it belongs there.
3. MICRO-TASKS (microTasks): break any intimidating task into 2-10 minute steps, each with an actionableHook: a concrete first physical or on-screen move.
4. MOMENTUM MODE (momentumMode): give a ridiculously easy 2-5 minute activationHook, flag cave activities / fake-dopamine traps in antiDopamineTraps (without blaming the person), and define a clear singleFocusShield.
5. Respond in English, direct and human tone. Do not invent tasks the person did not mention. Do not literally repeat the same text across trays and steps.`

export async function runTriage(ctx: TriageContext) {
  const isEn = ctx.locale === 'en'
  const system = isEn ? SYSTEM_EN : SYSTEM_ES
  const prompt = isEn
    ? `TODAY'S DATE: ${ctx.today}\n\nPERSON'S BRAIN DUMP:\n"""\n${ctx.rawDump}\n"""`
    : `FECHA DE HOY: ${ctx.today}\n\nVACIADO MENTAL DE LA PERSONA:\n"""\n${ctx.rawDump}\n"""`

  return generateStructured({ system, prompt, schema: triageSchema })
}
