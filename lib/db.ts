import { Pool, type PoolClient } from 'pg'
import { logFailure } from './operations.ts'

let pool: Pool | undefined

/**
 * Una sola reserva de conexiones para todo el proceso. No lanza error al
 * construirse: si falta DATABASE_URL, el fallo aparece al primer consulta
 * con un mensaje claro, y no al importar el módulo (lo que rompería el build).
 */
export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // En Render, la app y la base viven en la misma red privada: no hace
      // falta TLS. Fuera de ahí se activa con DATABASE_SSL=require.
      ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

export type SqlClient = Pick<PoolClient, 'query'>

/** Short DB-only unit of work. A failed rollback must not hide the primary failure. */
export async function transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch (secondary) { broken = true; logFailure('db.rollback', secondary) }
    throw error
  } finally { client.release(broken) }
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db().query(text, params as unknown[])
  return result.rows as T[]
}

/** Devuelve la primera fila o null. Nunca lanza por "no encontrado". */
export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}
