import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import type { z } from 'zod'

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
] as const

export const DEFAULT_MODEL = process.env.NEBIUS_MODEL?.trim() || CANDIDATE_MODELS[0]

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
  const started = performance.now()

  try {
    const { output, usage } = await generateText({
      model,
      output: Output.object({ schema: args.schema }),
      abortSignal: AbortSignal.timeout(60_000),
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
    const kind = error instanceof Error ? error.name : typeof error
    const status = (error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status
    console.error(`[nebius] ${modelId} falló tras ${Math.round(performance.now() - started)} ms · ${kind}${status ? ` · HTTP ${status}` : ''}`)
    throw new Error('No se pudo completar la respuesta estructurada de Nebius.')
  }
}
