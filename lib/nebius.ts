import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { reserveProvider } from './admission.ts'
import { logFailure, withContext } from './operations.ts'

// Endpoint fijo a propósito: este producto existe para demostrar Nebius Token
// Factory, no para elegir el mejor proveedor disponible.
export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'

/**
 * Solo laboratorios occidentales, por decisión del proyecto. El modelo por
 * defecto es Gemma 3; los demás existen para la comparación medida, no para
 * que el sistema cambie de modelo solo.
 *
 * Los identificadores exactos se confirman contra la API con `npm run models`
 * antes de correr nada en serio: una lista escrita de memoria envejece.
 */
export const CANDIDATE_MODELS = [
  'google/gemma-3-27b-it',
  'meta-llama/Llama-3.3-70B-Instruct',
  'openai/gpt-oss-120b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/Nemotron-3-Ultra-550b-a55b',
  'NousResearch/Hermes-4-405B',
] as const

/**
 * El triage: lo que la persona espera mirando la pantalla. Gemma 3 con el
 * prompt corto del vaciado responde en ~3 s y su evaluación está publicada.
 */
export const DEFAULT_MODEL = process.env.NEBIUS_MODEL?.trim() || CANDIDATE_MODELS[0]

/**
 * La investigación: otro trabajo, otro modelo, y la razón está medida.
 *
 * Los pasos de investigación mandan los hallazgos completos al modelo —unos
 * 4.500 caracteres— y con ese contexto Gemma se desborda de forma intermitente:
 * sigue generando hasta agotar el techo y devuelve un JSON partido. Medido
 * sobre el paso de la guía, tres intentos por modelo:
 *
 *   nvidia/Nemotron-3-Ultra-550b-a55b   3/3   5,3 s
 *   openai/gpt-oss-120b                 3/3   6,1 s
 *   google/gemma-3-27b-it               3/3  15,8 s  (y falla en corridas largas)
 *   NousResearch/Hermes-4-405B          3/3  60,8 s
 *   nvidia/nemotron-3-super-120b-a12b   0/3         (nunca produjo JSON válido)
 *
 * Se elige gpt-oss-120b: iguala en fiabilidad al Ultra con 800 ms más, siendo
 * un modelo mucho más chico. Aquí nadie está mirando la pantalla —esto corre
 * en segundo plano— así que esos 800 ms no compran nada y el tamaño sí cuesta.
 */
export const RESEARCH_MODEL = process.env.NEBIUS_RESEARCH_MODEL?.trim() || 'openai/gpt-oss-120b'

/**
 * Techo de salida. Existe porque sin él el SDK no manda `max_tokens` y el
 * proveedor no pone freno: una respuesta que se desboca —pasa, con salida
 * estructurada y arrays sin tope— sigue generando hasta agotar el timeout de
 * 60 s, y la persona se come el minuto entero para recibir un error.
 *
 * El valor lo usan el producto y `tests/eval.mjs` desde aquí, a propósito: si
 * cada uno tuviera el suyo, la evaluación dejaría de medir la misma petición
 * que se sirve, y ese es justo el tipo de diferencia que no se nota hasta que
 * alguien la audita.
 */
export const MAX_OUTPUT_TOKENS = 4096

function resolveModel(modelId: string) {
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) throw new Error('NEBIUS_API_KEY no está configurada.')
  return createOpenAI({ baseURL: NEBIUS_BASE_URL, apiKey }).chat(modelId)
}

export type StructuredResult<T> = {
  output: T
  model: string
  latencyMs: number
  promptTokens: number | null
  completionTokens: number | null
}

/**
 * Pide una salida validada por Zod. Nunca deja escapar el error crudo del SDK
 * (puede traer el prompt o la respuesta del modelo) hacia los logs ni hacia
 * el cliente.
 */
export async function generateStructured<T extends z.ZodTypeAny>(args: {
  system: string
  prompt: string
  schema: T
  modelId?: string
}): Promise<StructuredResult<z.infer<T>>> {
  const modelId = args.modelId ?? DEFAULT_MODEL
  const model = resolveModel(modelId)
  await reserveProvider('nebius')
  const started = performance.now()

  try {
    const { output, usage } = await generateText({
      model,
      output: Output.object({ schema: args.schema }),
      abortSignal: AbortSignal.timeout(60_000),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      system: args.system,
      prompt: args.prompt,
      temperature: 0.2,
    })

    return {
      output: args.schema.parse(output),
      model: modelId,
      latencyMs: Math.round(performance.now() - started),
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
    }
  } catch (error) {
    // El mensaje crudo del SDK puede traer el prompt o la respuesta del modelo,
    // así que no sale de aquí. Lo que sí sale es de qué tipo fue el fallo y con
    // qué código HTTP: sin eso, un error en producción es indistinguible de
    // otro y no hay forma de arreglarlo.
    withContext({ model: modelId }, () => logFailure('nebius.generate', error, Math.round(performance.now() - started)))
    throw new Error('No se pudo completar la respuesta estructurada de Nebius.')
  }
}
