// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export class PolicyError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number
  constructor(status: number, code: string, retryAfter?: number) {
    super(code)
    this.name = 'PolicyError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

type Context = { requestId?: string; runId?: string; generation?: number; step?: string; attempt?: number; phase?: string; repair?: boolean; model?: string; databaseTarget?: string; databaseTls?: 'require' | 'sin TLS' }
const context = new AsyncLocalStorage<Context>()
export function withContext<T>(fields: Context, work: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, work)
}
export function requestId() { return context.getStore()?.requestId ?? randomUUID() }

// Never serialize Error, message, stack, cause, headers, SQL parameters or provider payloads.
export function logFailure(operation: string, error: unknown, durationMs?: number) {
  const e = error as { name?: unknown; code?: unknown; statusCode?: unknown; status?: unknown } | null
  const names = ['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'PolicyError', 'StepBusyError', 'StaleExecutionError']
  const code = typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined
  const status = e?.statusCode ?? e?.status
  const policyCodes = ['QUOTA_EXHAUSTED', 'BUDGET_UNAVAILABLE', 'ADMISSION_CLOSED', 'GUEST_CONFIGURATION', 'ORIGIN_CONFIGURATION',
    'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'ACTIVE_RESEARCH_LIMIT', 'ATTEMPTS_EXHAUSTED', 'INCOMPLETE_ROUND', 'UNGROUNDED_GUIDE',
    'WORKFLOW_NOT_CONFIGURED', 'INCOMPLETE_STEPS', 'EXECUTION_VERSION_REQUIRED', 'EXECUTION_CONTEXT_REQUIRED']
  console.error(JSON.stringify({ event: operation, ...context.getStore(), kind: names.includes(String(e?.name)) ? e?.name : 'ExternalError',
    code: error instanceof PolicyError && policyCodes.includes(error.code) ? error.code : undefined,
    sqlstate: code, status: typeof status === 'number' ? status : undefined, durationMs }))
}

export function failureResponse(error: unknown, fallback = 503): Response {
  const known = error instanceof PolicyError
  const status = known ? error.status : fallback
  const messages: Record<number, string> = {
    400: 'Solicitud inválida.', 403: 'Origen no permitido.', 404: 'Esa investigación no existe.',
    409: 'La solicitud entra en conflicto con una investigación existente.', 413: 'La solicitud es demasiado grande.',
    415: 'Se requiere JSON.', 428: 'Abre una sesión de invitado antes de continuar.',
    429: 'Se alcanzó un límite de uso. Intenta más tarde.', 502: 'No se pudo procesar la solicitud en este momento.',
    503: 'El servicio no está disponible en este momento.',
  }
  return Response.json({ error: messages[status] ?? messages[503], code: known ? error.code : 'UNAVAILABLE', requestId: requestId() }, {
    status, headers: { 'Cache-Control': 'no-store', ...(known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) },
  })
}
