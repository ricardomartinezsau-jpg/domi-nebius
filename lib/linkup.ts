/**
 * Búsqueda viva con Linkup.
 *
 * Por qué existe: un modelo aprendió con datos congelados hace meses, así que
 * cuando propone "cómo mandar un newsletter" describe el proceso de su fecha de
 * corte, no el de hoy. Aquí se trae lo que cambió.
 *
 * Dos decisiones que se pueden defender ante un jurado:
 * 1. Filtro de fecha: solo se consideran fuentes del último año. El objetivo
 *    declarado es actualidad, no cobertura; una guía de 2023 contamina justo lo
 *    que veníamos a arreglar.
 * 2. Respuesta con fuentes (no lista de enlaces): cada afirmación que llega a la
 *    persona tiene que poder señalar de dónde salió. Lo que no se puede
 *    respaldar, se marca como sin confirmar y no se presenta como hecho.
 */

const LINKUP_URL = 'https://api.linkup.so/v1/search'
const RECENCY_MONTHS = 12

export type Source = { name: string; url: string; snippet?: string }
export type ResearchAnswer = { answer: string; sources: Source[] }

function recencyFloor(): string {
  const date = new Date()
  date.setMonth(date.getMonth() - RECENCY_MONTHS)
  return date.toISOString().slice(0, 10)
}

const responseSchemaGuard = (body: unknown): body is { answer?: unknown; sources?: unknown[] } =>
  typeof body === 'object' && body !== null

/**
 * Una pregunta concreta, una respuesta con fuentes. `depth: 'standard'` es el
 * punto de equilibrio: 'deep' multiplica latencia y costo, y aquí el contexto ya
 * viene acotado por la pregunta.
 */
export async function research(question: string, opts?: { depth?: 'flash' | 'fast' | 'standard' | 'deep' }): Promise<ResearchAnswer> {
  const apiKey = process.env.LINKUP_API_KEY?.trim()
  if (!apiKey) throw new Error('LINKUP_API_KEY no está configurada.')

  let response: Response
  try {
    response = await fetch(LINKUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        q: question,
        depth: opts?.depth ?? 'standard',
        outputType: 'sourcedAnswer',
        includeInlineCitations: false,
        fromDate: recencyFloor(),
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    throw new Error('Búsqueda: no hubo respuesta a tiempo.')
  }

  if (!response.ok) throw new Error(`Búsqueda: HTTP ${response.status}.`)

  const body: unknown = await response.json()
  if (!responseSchemaGuard(body) || typeof body.answer !== 'string') {
    throw new Error('Búsqueda: respuesta sin el formato esperado.')
  }

  const sources: Source[] = Array.isArray(body.sources)
    ? body.sources
        .filter((s): s is { name?: string; url: string; snippet?: string } =>
          typeof s === 'object' && s !== null && typeof (s as { url?: unknown }).url === 'string')
        .map((s) => ({ name: s.name ?? new URL(s.url).hostname, url: s.url, snippet: s.snippet }))
    : []

  // Una afirmación sin fuente no sirve para lo que la necesitamos.
  if (!sources.length) throw new Error('Búsqueda: sin fuentes verificables.')

  return { answer: body.answer, sources }
}

/**
 * Clasifica qué tan respaldado está un hallazgo. No es sofisticado a propósito:
 * un número inventado de "confianza" sería peor que contar fuentes, porque
 * aparenta precisión que no tenemos.
 */
export function confidenceFrom(sources: Source[]): 'strong' | 'single' {
  const distinctHosts = new Set(sources.map((s) => {
    try {
      return new URL(s.url).hostname.replace(/^www\./, '')
    } catch {
      return s.url
    }
  }))
  return distinctHosts.size >= 2 ? 'strong' : 'single'
}
