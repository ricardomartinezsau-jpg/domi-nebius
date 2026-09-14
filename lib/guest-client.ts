// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'

let bootstrap: Promise<void> | null = null
const PREFIX = 'domi.research.intent.v1.'

async function browserLock<T>(name: string, work: () => Promise<T>) {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, work)
  return work()
}
export async function ensureGuest() {
  if (!bootstrap) bootstrap = browserLock('domi:guest', async () => {
    const response = await fetch('/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error('No se pudo abrir la sesión de invitado. Intenta más tarde.')
  }).finally(() => { bootstrap = null })
  await bootstrap
}
export async function guestFetch(url: string, options: RequestInit): Promise<Response> {
  await ensureGuest()
  options.signal?.throwIfAborted()
  return fetch(url, options)
}

type Input = { taskTitle?: string; contextArea?: string; blocker: string; locale?: 'es' | 'en' }
async function intentHash(input: Input) {
  const body = JSON.stringify({ taskTitle: input.taskTitle?.trim() || undefined, contextArea: input.contextArea,
    blocker: input.blocker.trim(), locale: input.locale ?? 'es' })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return { body, storageKey: PREFIX + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') }
}

/** Persist before sending. Neither a transport failure nor a reload creates a new key. */
export async function createResearch(input: Input): Promise<Response> {
  const { body, storageKey } = await intentHash(input)
  return browserLock(storageKey, async () => {
    // If storage is unavailable, fail before POST instead of losing replay safety.
    const saved = localStorage.getItem(storageKey)
    const record: { key: string; confirmed?: boolean } = saved ? JSON.parse(saved) : { key: crypto.randomUUID() }
    localStorage.setItem(storageKey, JSON.stringify(record))
    const response = await guestFetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.key }, body, signal: AbortSignal.timeout(30_000) })
    if (response.ok) {
      // Keep the key even after acceptance: the UI/session write might still be interrupted.
      localStorage.setItem(storageKey, JSON.stringify({ ...record, confirmed: true }))
    }
    return response
  })
}

/** Only an explicit "Pedir otra" action retires acknowledged intents; never uncertain ones. */
export function beginFreshResearch() {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(PREFIX)) continue
    try { if (JSON.parse(localStorage.getItem(key) ?? '{}').confirmed) localStorage.removeItem(key) } catch { /* preserve uncertain entries */ }
  }
}
export async function resumeResearch(runId: string) {
  // Do not mint a replacement identity on resume: lost ownership must stay a 404.
  return fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(30_000) })
}
