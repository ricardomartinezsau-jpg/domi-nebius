import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runTriage } from '@/lib/triage'

export const runtime = 'nodejs'

// Garantía formal de entrada: nunca se manda al modelo un texto vacío,
// gigantesco o de un tipo inesperado. 4000 caracteres alcanza para un
// vaciado mental real sin abrir la puerta a abuso de tokens.
const requestSchema = z.object({
  rawDump: z.string().trim().min(1, 'Escribe algo antes de enviarlo.').max(4000, 'Máximo 4000 caracteres.'),
  locale: z.enum(['es', 'en']).default('es'),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'El cuerpo de la solicitud no es JSON válido.' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' }, { status: 400 })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const { output, model } = await runTriage({ rawDump: parsed.data.rawDump, today, locale: parsed.data.locale })
    return NextResponse.json({ output, model })
  } catch {
    // El detalle del fallo (SDK, red, contenido del modelo) nunca sale de este proceso.
    return NextResponse.json(
      { error: 'No se pudo procesar el vaciado en este momento. Intenta de nuevo en unos segundos.' },
      { status: 502 },
    )
  }
}
