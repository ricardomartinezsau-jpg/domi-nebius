import { NextResponse } from 'next/server'
import { z } from 'zod'
import { quickSchema, runQuickTriage, runDetailTriage } from '@/lib/triage'

export const runtime = 'nodejs'

// Garantía formal de entrada: nunca se manda al modelo un texto vacío,
// gigantesco o de un tipo inesperado.
const baseRequest = z.object({
  rawDump: z.string().trim().min(1, 'Escribe algo antes de enviarlo.').max(4000, 'Máximo 4000 caracteres.'),
  locale: z.enum(['es', 'en']).default('es'),
})

/**
 * Dos fases. La rápida devuelve bandejas y arranque en pocos segundos; la de
 * detalle llega después, cuando la persona ya tiene algo que hacer. El cliente
 * devuelve la fase rápida para pedir la segunda: así el modo sin cuenta no
 * necesita que guardemos nada de su contenido en el servidor.
 */
const requestSchema = z.discriminatedUnion('phase', [
  baseRequest.extend({ phase: z.literal('quick') }),
  baseRequest.extend({ phase: z.literal('detail'), quick: quickSchema }),
])

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

  const today = new Date().toISOString().slice(0, 10)
  const ctx = { rawDump: parsed.data.rawDump, today, locale: parsed.data.locale }

  try {
    const result =
      parsed.data.phase === 'quick'
        ? await runQuickTriage(ctx)
        : await runDetailTriage(ctx, parsed.data.quick)
    return NextResponse.json({ output: result.output, model: result.model, latencyMs: result.latencyMs })
  } catch {
    // El detalle del fallo (SDK, red, contenido del modelo) no sale de este proceso.
    return NextResponse.json(
      { error: 'No se pudo procesar el vaciado en este momento. Intenta de nuevo en unos segundos.' },
      { status: 502 },
    )
  }
}
