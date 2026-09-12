import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Render } from '@renderinc/sdk'
import { advanceResearch, createResearchRun, readResearch } from '@/lib/research'
import { query } from '@/lib/db'
import '@/lib/workflows'

export const runtime = 'nodejs'

async function dispatchResearch(runId: string): Promise<void> {
  const token = process.env.RENDER_API_KEY?.trim()
  if (token) {
    try {
      const render = new Render({ token })
      const slug = process.env.RENDER_WORKFLOW_SLUG || 'domi-research'
      const workflowRun = await render.workflows.startTask(`${slug}/research`, [runId])
      await query('UPDATE runs SET task_run_id = $2 WHERE id = $1', [runId, workflowRun.taskRunId])
      return
    } catch (error) {
      console.error('Fallo al iniciar task en Render Workflows, usando ejecución directa:', error)
    }
  }
  void advanceResearch(runId).catch(() => {})
}

/**
 * Iniciar una investigación y consultarla después son dos cosas separadas a
 * propósito: quien la inicia recibe un identificador y puede cerrar la pestaña.
 * El trabajo no depende de que siga mirando.
 */
const startSchema = z.object({
  taskTitle: z.string().trim().min(1, 'Falta la tarea.').max(300),
  blocker: z.string().trim().min(1, '¿Qué te frena?').max(1000),
  locale: z.enum(['es', 'en']).default('es'),
})

const resumeSchema = z.object({ runId: z.string().uuid() })

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'El cuerpo de la solicitud no es JSON válido.' }, { status: 400 })
  }

  // Reanudar una ejecución que se quedó a medias: los pasos ya terminados no
  // se repiten, así que llamar de más es inofensivo.
  const resume = resumeSchema.safeParse(body)
  if (resume.success) {
    const existing = await readResearch(resume.data.runId)
    if (!existing) return NextResponse.json({ error: 'Esa investigación no existe.' }, { status: 404 })
    void dispatchResearch(resume.data.runId)
    return NextResponse.json({ runId: resume.data.runId, resumed: true })
  }

  const parsed = startSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' }, { status: 400 })
  }

  let runId: string
  try {
    runId = await createResearchRun(parsed.data)
  } catch {
    return NextResponse.json({ error: 'No se pudo abrir la investigación en este momento.' }, { status: 503 })
  }

  // Dispara el workflow en Render sin bloquear la respuesta. El estado vive en la base.
  void dispatchResearch(runId)
  return NextResponse.json({ runId }, { status: 202 })
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get('runId')
  if (!runId || !z.string().uuid().safeParse(runId).success) {
    return NextResponse.json({ error: 'Falta el identificador de la investigación.' }, { status: 400 })
  }

  try {
    const view = await readResearch(runId)
    if (!view) return NextResponse.json({ error: 'Esa investigación no existe.' }, { status: 404 })
    return NextResponse.json(view)
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el estado de la investigación.' }, { status: 503 })
  }
}
