import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGuest, mutationBody, ipBucket } from '@/lib/guest'
import { admitTriage, LIMITS } from '@/lib/admission'
import { PolicyError, failureResponse, logFailure, withContext, requestId } from '@/lib/operations'
import { quickSchema, runQuickTriage, runDetailTriage, type TriageContext } from '@/lib/triage'
import {
  SAFE_SOMATIC_HOOK,
  clampDetail,
  failures,
  repairInstruction,
  verifyDetail,
  verifyQuick,
  type Rule,
} from '@/lib/verify'

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

/** Lo que se le cuenta al cliente sobre las reglas duras que corrieron. */
export type Guardrails = {
  checked: string[]
  failed: string[]
  /** Hubo un segundo intento pidiéndole al modelo que corrigiera. */
  repaired: boolean
  /** El arranque lo puso el sistema, no el modelo. Solo pasa en crisis física. */
  safeHookApplied: boolean
}

const report = (rules: Rule[], repaired: boolean, safeHookApplied: boolean): Guardrails => ({
  checked: rules.map((rule) => rule.id),
  failed: failures(rules).map((rule) => rule.id),
  repaired,
  safeHookApplied,
})

/**
 * Un solo intento de reparación, y solo si alguna regla rota es reparable.
 * Se queda con la respuesta que rompe menos reglas: pedirle al modelo que
 * corrija no garantiza que corrija, y una segunda respuesta peor no entra.
 */
async function repairOnce<T>(
  rules: Rule[],
  rerun: (instruction: string) => Promise<T>,
  check: (candidate: T) => Rule[],
): Promise<{ output: T | null; rules: Rule[]; repaired: boolean }> {
  if (!failures(rules).some((rule) => rule.repairable)) return { output: null, rules, repaired: false }
  try {
    const candidate = await withContext({ repair: true }, () => rerun(repairInstruction(rules)))
    const candidateRules = check(candidate)
    if (failures(candidateRules).length < failures(rules).length) {
      return { output: candidate, rules: candidateRules, repaired: true }
    }
  } catch (error) {
    logFailure('triage.repair', error)
    if (error instanceof PolicyError) throw error
    // La reparación es un extra: si falla, se responde con lo que ya se tenía.
  }
  return { output: null, rules, repaired: false }
}

async function quickPhase(ctx: TriageContext) {
  const first = await runQuickTriage(ctx)
  const check = (candidate: typeof first.output) => verifyQuick(candidate, { rawDump: ctx.rawDump })
  const firstRules = check(first.output)

  // Cuando lo que falla es la regla somática, no se pide una corrección: se
  // aplica el texto fijo y punto. Medido, la reparación añadía unos cuatro
  // segundos de espera justo en el caso de alguien que dice que no puede
  // respirar, y terminaba en el mismo texto fijo de todas formas.
  if (failures(firstRules).some((rule) => rule.id === 'somatic-override')) {
    const output = {
      ...first.output,
      momentumMode: { ...first.output.momentumMode, activationHook: SAFE_SOMATIC_HOOK[ctx.locale ?? 'es'] },
    }
    return { output, model: first.model, latencyMs: first.latencyMs, guardrails: report(check(output), false, true) }
  }

  const attempt = await repairOnce(
    firstRules,
    async (instruction) => (await runQuickTriage(ctx, { repair: instruction })).output,
    check,
  )

  return {
    output: attempt.output ?? first.output,
    model: first.model,
    latencyMs: first.latencyMs,
    guardrails: report(attempt.rules, attempt.repaired, false),
  }
}

async function detailPhase(ctx: TriageContext, quick: z.infer<typeof quickSchema>) {
  const first = await runDetailTriage(ctx, quick)
  const check = (candidate: typeof first.output) => verifyDetail(candidate, { rawDump: ctx.rawDump })

  const attempt = await repairOnce(
    check(first.output),
    async (instruction) => (await runDetailTriage(ctx, quick, { repair: instruction })).output,
    check,
  )

  // El recorte va después de verificar: el informe registra que la regla se
  // rompió y la persona recibe la lista acotada de todos modos.
  return {
    output: clampDetail(attempt.output ?? first.output),
    model: first.model,
    latencyMs: first.latencyMs,
    guardrails: report(attempt.rules, attempt.repaired, false),
  }
}

export async function POST(request: Request) {
  return withContext({ requestId: requestId() }, async () => {
  try {
  const body = await mutationBody(request, LIMITS.triageBytes)
  const owner = requireGuest(request)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' }, { status: 400 })
  }
  if (parsed.data.phase === 'detail' && parsed.data.quick.momentumMode.activationHook.length > 1000) throw new PolicyError(400, 'HOOK_TOO_LONG')
  await admitTriage(owner, ipBucket(request))

  const today = new Date().toISOString().slice(0, 10)
  const ctx: TriageContext = { rawDump: parsed.data.rawDump, today, locale: parsed.data.locale }

    const data = parsed.data
    const result = await withContext({ phase: data.phase }, () => data.phase === 'quick' ? quickPhase(ctx) : detailPhase(ctx, data.quick))
    return NextResponse.json({ ...result, requestId: requestId() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logFailure('triage.request', error)
    return failureResponse(error, 502)
  }
  })
}
