import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Render } from '@renderinc/sdk'
import { advanceResearch, createResearchRun, readResearch } from '@/lib/research'
import { query } from '@/lib/db'
import '@/lib/workflows'

export const runtime = 'nodejs'

/**
 * Entrega la ejecución a Render Workflows, y solo si eso no se pudo, la corre
 * aquí mismo.
 *
 * El orden importa más de lo que parece: guardar el identificador de Render y
 * disparar la tarea tienen que ir en bloques separados. Estaban juntos, y
 * bastaba con que la base tosiera un segundo DESPUÉS de un disparo correcto
 * para que esto creyera que Render había fallado y arrancara una segunda
 * ejecución en paralelo a la que ya estaba corriendo allá.
 */
async function dispatchResearch(runId: string): Promise<void> {
  const token = process.env.RENDER_API_KEY?.trim()

  if (token) {
    let taskRunId: string | null = null
    try {
      const render = new Render({ token })
      const slug = process.env.RENDER_WORKFLOW_SLUG || 'domi-research'
      taskRunId = (await render.workflows.startTask(`${slug}/research`, [runId])).taskRunId
    } catch (error) {
      console.error(`[research] ${runId}: Render Workflows no aceptó la tarea, se ejecuta aquí ·`, error instanceof Error ? error.name : error)
    }

    if (taskRunId) {
      // A partir de aquí la tarea YA está corriendo en Render. Si no se puede
      // anotar su identificador, se pierde la traza, no la ejecución: volver
      // atrás y correrla en local sería duplicarla.
      try {
        await query('UPDATE runs SET task_run_id = $2 WHERE id = $1', [runId, taskRunId])
      } catch (error) {
        console.error(`[research] ${runId}: corre en Render como ${taskRunId} pero no se pudo anotar ·`, error instanceof Error ? error.name : error)
      }
      return
    }
  }

  // El error ya queda escrito en runs.status y runs.error dentro de
  // advanceResearch; esto solo evita tumbar el proceso y deja rastro.
  void advanceResearch(runId).catch((error) => {
    console.error(`[research] ${runId}: la ejecución local terminó en fallo ·`, error instanceof Error ? error.message : error)
  })
}

/**
 * Iniciar una investigación y consultarla después son dos cosas separadas a
 * propósito: quien la inicia recibe un identificador y puede cerrar la pestaña.
 * El trabajo no depende de que siga mirando.
 */
const startSchema = z.object({
  taskTitle: z.string().trim().max(300).optional(),
  contextArea: z.enum(['trabajo', 'personal', 'casa', 'social']).optional(),
  blocker: z.string().trim().min(1, '¿Qué te frena?').max(1000),
  locale: z.enum(['es', 'en']).default('es'),
}).refine(data => data.taskTitle || data.contextArea, { message: 'Debe haber una tarea o un área de contexto.' })

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
