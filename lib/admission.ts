// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { transaction, type SqlClient } from './db.ts'
import { PolicyError, logFailure } from './operations.ts'

export const LIMITS = Object.freeze({ researchDaily: 3, researchIpDaily: 10, active: 1,
  triageMinute: 6, triageDaily: 20, triageIpDaily: 60, readsMinute: 120,
  nebius: 300, linkup: 60, render: 20, stepAttempts: 4, researchBytes: 8192, triageBytes: 65536 })

export function assertAdmission() {
  if (process.env.DOMI_ADMISSION_ENABLED !== 'true') throw new PolicyError(503, 'ADMISSION_CLOSED')
}

export type Reservation = { key: string; seconds: number; limit: number; units?: number }

/** Caller owns the transaction: refusal rolls back ALL counters and associated writes. */
export async function reserveLimits(client: SqlClient, limits: Reservation[], admissionRequired = true) {
  if (admissionRequired) assertAdmission()
  // Deterministic lock order prevents opposite-order quota deadlocks.
  for (const item of [...limits].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!Number.isSafeInteger(item.units ?? 1) || (item.units ?? 1) < 1 || (item.units ?? 1) > item.limit || item.seconds < 1) throw new PolicyError(503, 'INVALID_QUOTA_CONFIGURATION')
    const result = await client.query(
      `INSERT INTO admission_counters (bucket_key, window_start, used)
       VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2::int) * $2::int), $3)
       ON CONFLICT (bucket_key, window_start) DO UPDATE
       SET used = admission_counters.used + EXCLUDED.used
       WHERE admission_counters.used + EXCLUDED.used <= $4
       RETURNING used`, [item.key, item.seconds, item.units ?? 1, item.limit])
    if (!result.rows.length) throw new PolicyError(429, 'QUOTA_EXHAUSTED', item.seconds)
  }
}

export async function reserve(limits: Reservation[], admissionRequired = true) {
  if (admissionRequired) assertAdmission()
  try { await transaction(client => reserveLimits(client, limits, admissionRequired)) }
  catch (error) {
    if (error instanceof PolicyError) throw error
    logFailure('admission.db', error)
    throw new PolicyError(503, 'BUDGET_UNAVAILABLE')
  }
}

export const daily = (key: string, limit: number, units = 1): Reservation => ({ key, limit, units, seconds: 86400 })
export function researchLimits(owner: string, ip: string) {
  return [daily(`research:guest:${owner}`, LIMITS.researchDaily), daily(`research:ip:${ip}`, LIMITS.researchIpDaily)]
}
export async function admitTriage(owner: string, ip: string) {
  await reserve([{ key: `triage:minute:${owner}`, limit: LIMITS.triageMinute, seconds: 60 },
    daily(`triage:guest:${owner}`, LIMITS.triageDaily), daily(`triage:ip:${ip}`, LIMITS.triageIpDaily)])
}
export async function reserveProvider(provider: 'nebius' | 'linkup' | 'render') {
  // Nebius uses maxRetries:1; reserve BOTH possible HTTP attempts, no refunds.
  await reserve([daily(`global:${provider}`, LIMITS[provider], provider === 'nebius' ? 2 : 1)])
}
