// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

/**
 * Pregunta a Nebius Token Factory qué modelos sirve HOY y marca cuáles de
 * nuestros candidatos siguen existiendo.
 *
 * Existe porque una lista de modelos escrita a mano envejece en semanas, y
 * descubrirlo en medio de una demo es caro.
 *
 * Uso: NEBIUS_API_KEY=... node tools/models.mjs [--embeddings]
 */
const BASE_URL = 'https://api.tokenfactory.nebius.com/v1'

const CANDIDATES = [
  'google/gemma-3-27b-it',
  'meta-llama/Llama-3.3-70B-Instruct',
  'openai/gpt-oss-120b',
  'nvidia/Nemotron-3-super-120b-a12b',
]

async function main() {
  const apiKey = process.env.NEBIUS_API_KEY?.trim()
  if (!apiKey) {
    console.error('NEBIUS_API_KEY no está configurada en este proceso.')
    process.exitCode = 2
    return
  }

  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    console.error(`HTTP ${response.status}; cuerpo omitido para proteger credenciales.`)
    process.exitCode = 1
    return
  }

  const body = await response.json()
  const ids = (body?.data ?? []).map((m) => m?.id).filter((id) => typeof id === 'string').sort()

  if (process.argv.includes('--embeddings')) {
    const embeddings = ids.filter((id) => /embed/i.test(id))
    console.log(`Modelos de huellas numéricas (${embeddings.length}):`)
    for (const id of embeddings) console.log(' -', id)
    return
  }

  console.log(`Modelos servidos: ${ids.length}\n`)
  console.log('Nuestros candidatos:')
  for (const candidate of CANDIDATES) {
    const exact = ids.includes(candidate)
    const similar = exact ? null : ids.find((id) => id.toLowerCase() === candidate.toLowerCase())
    console.log(` ${exact ? 'OK  ' : similar ? 'CASO' : 'NO  '} ${candidate}${similar ? ` -> usa "${similar}"` : ''}`)
  }
  console.log('\nTodos los identificadores disponibles:')
  for (const id of ids) console.log(' -', id)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falló la consulta de modelos.')
  process.exitCode = 1
})
