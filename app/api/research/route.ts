import { z } from 'zod'
import { readResearch } from '@/lib/research'
import { createResearchRun } from '@/lib/research-lifecycle'
import { dispatchResearch } from '@/lib/research-dispatch'
import { requireGuest, mutationBody, ipBucket } from '@/lib/guest'
import { LIMITS } from '@/lib/admission'
import { PolicyError, failureResponse, logFailure, requestId, withContext } from '@/lib/operations'
import { requestedDemoFault } from '@/lib/demo-fault'

export const runtime = 'nodejs'
const startSchema = z.object({
  taskTitle: z.string().trim().max(300).optional(),
  contextArea: z.enum(['trabajo', 'personal', 'casa', 'social']).optional(),
  blocker: z.string().trim().min(1).max(1000),
  locale: z.enum(['es', 'en']).default('es'),
}).refine(data => data.taskTitle || data.contextArea)
const resumeSchema = z.object({ runId: z.string().uuid() }).strict()

export async function POST(request: Request) {
  return withContext({ requestId: requestId() }, async () => {
    try {
      const body = await mutationBody(request, LIMITS.researchBytes)
      const isResume = typeof body === 'object' && body !== null && 'runId' in body
      const owner = requireGuest(request, isResume)
      let runId: string
      if (isResume) {
        const parsed = resumeSchema.safeParse(body)
        if (!parsed.success) throw new PolicyError(400, 'INVALID_REQUEST')
        runId = parsed.data.runId
      } else {
        const parsed = startSchema.safeParse(body)
        if (!parsed.success) throw new PolicyError(400, 'INVALID_REQUEST')
        // This is intentionally header-only: the public JSON contract cannot
        // select a demo run, and the secret never reaches browser code.
        runId = await createResearchRun(parsed.data, owner, request.headers.get('idempotency-key') ?? '', ipBucket(request),
          { demoFault: requestedDemoFault(request) })
      }
      const result = await dispatchResearch(runId, owner)
      return Response.json({ ...result, requestId: requestId() }, {
        status: result.accepted ? (result.dispatchState === 'done' ? 200 : 202) : 503,
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch (error) { logFailure('research.mutation', error); return failureResponse(error) }
  })
}

export async function GET(request: Request) {
  return withContext({ requestId: requestId() }, async () => {
    try {
      const owner = requireGuest(request, true)
      const runId = new URL(request.url).searchParams.get('runId')
      if (!z.string().uuid().safeParse(runId).success) throw new PolicyError(400, 'INVALID_RUN_ID')
      const view = await readResearch(runId!, owner)
      if (!view) throw new PolicyError(404, 'NOT_FOUND')
      return Response.json(view, { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId() } })
    } catch (error) { logFailure('research.read', error); return failureResponse(error) }
  })
}
