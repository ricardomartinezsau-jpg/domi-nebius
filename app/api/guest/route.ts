import { issueGuest, readGuest, setGuestCookie, mutationBody } from '@/lib/guest'
import { assertAdmission } from '@/lib/admission'
import { failureResponse, logFailure, withContext, requestId } from '@/lib/operations'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  return withContext({ requestId: requestId() }, async () => {
    try {
      await mutationBody(request, 256)
      assertAdmission()
      const existing = readGuest(request)
      return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store', ...(!existing ? { 'Set-Cookie': setGuestCookie(issueGuest()) } : {}) } })
    } catch (error) { logFailure('guest.bootstrap', error); return failureResponse(error) }
  })
}
