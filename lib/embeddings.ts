// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

/**
 * Huellas numéricas: convierten una tarea en un vector para poder buscar por
 * parecido ("esto ya lo intentaste tres veces") y no por palabra exacta.
 *
 * Hay dos proveedores porque hay una tensión real: el proyecto usa solo
 * modelos de laboratorios occidentales, y los modelos de huellas que sirve
 * Nebius hoy no lo son. Este archivo deja la decisión en una variable de
 * entorno en vez de enterrarla en el código.
 */

const NEBIUS_URL = 'https://api.tokenfactory.nebius.com/v1/embeddings'
const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Debe coincidir con vector(1024) en db/migrations/0002_domain.sql. */
export const EMBEDDING_DIMENSIONS = 1024

const PROVIDER = (process.env.EMBEDDINGS_PROVIDER?.trim() as 'nebius' | 'google') || 'nebius'
const NEBIUS_MODEL = process.env.NEBIUS_EMBEDDING_MODEL?.trim() || 'Qwen/Qwen3-Embedding-8B'
const GOOGLE_MODEL = process.env.GOOGLE_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001'

export function embeddingModelId(): string {
  return PROVIDER === 'google' ? `google/${GOOGLE_MODEL}` : `nebius/${NEBIUS_MODEL}`
}

/**
 * Coseno solo compara bien vectores de la misma longitud. Al recortar
 * dimensiones (ambos proveedores lo permiten) hay que volver a normalizar o
 * las distancias dejan de significar lo que creemos.
 */
function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector
}

async function embedWithNebius(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) throw new Error('NEBIUS_API_KEY no está configurada.')

  const response = await fetch(NEBIUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: NEBIUS_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Huellas: HTTP ${response.status}.`)

  const body = (await response.json()) as { data?: { embedding?: number[]; index?: number }[] }
  const rows = body.data ?? []
  if (rows.length !== texts.length) throw new Error('Huellas: respuesta incompleta.')
  return rows
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => normalize(row.embedding ?? []))
}

async function embedWithGoogle(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GOOGLE_API_KEY?.trim()
  if (!apiKey) throw new Error('GOOGLE_API_KEY no está configurada.')

  const response = await fetch(`${GOOGLE_URL}/${GOOGLE_MODEL}:batchEmbedContents?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${GOOGLE_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Huellas: HTTP ${response.status}.`)

  const body = (await response.json()) as { embeddings?: { values?: number[] }[] }
  const rows = body.embeddings ?? []
  if (rows.length !== texts.length) throw new Error('Huellas: respuesta incompleta.')
  return rows.map((row) => normalize(row.values ?? []))
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  try {
    const vectors = PROVIDER === 'google' ? await embedWithGoogle(texts) : await embedWithNebius(texts)
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Huellas: se esperaban ${EMBEDDING_DIMENSIONS} dimensiones y llegaron ${vector.length}.`)
      }
    }
    return vectors
  } catch (error) {
    // El detalle externo no se propaga: puede traer la clave o el texto de la persona.
    throw new Error(error instanceof Error && error.message.startsWith('Huellas:') ? error.message : 'No se pudieron calcular las huellas numéricas.')
  }
}

/** Formato que entiende pgvector al insertar: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
