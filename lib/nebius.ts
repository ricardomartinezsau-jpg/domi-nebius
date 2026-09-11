import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import type { z } from 'zod'

// Endpoint y modelo fijos a propósito: este MVP existe para demostrar Nebius
// Token Factory, no para elegir el mejor proveedor disponible.
export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
export const NEBIUS_MODEL = 'meta-llama/Llama-3.3-70B-Instruct'

function resolveModel() {
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) throw new Error('NEBIUS_API_KEY no está configurada.')
  return createOpenAI({ baseURL: NEBIUS_BASE_URL, apiKey }).chat(NEBIUS_MODEL)
}

export type StructuredResult<T> = { output: T; model: string }

/**
 * Pide una salida validada por Zod a Nebius. Nunca deja escapar el error
 * crudo del SDK (puede traer el prompt o la respuesta del modelo) hacia
 * logs o hacia el cliente.
 */
export async function generateStructured<T extends z.ZodTypeAny>(args: {
  system: string
  prompt: string
  schema: T
}): Promise<StructuredResult<z.infer<T>>> {
  const model = resolveModel()

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: args.schema }),
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 1,
      system: args.system,
      prompt: args.prompt,
      temperature: 0.2,
    })

    return { output: args.schema.parse(output), model: NEBIUS_MODEL }
  } catch {
    throw new Error('No se pudo completar la respuesta estructurada de Nebius.')
  }
}
