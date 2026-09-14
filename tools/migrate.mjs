// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

/**
 * Aplica db/migrations/*.sql en orden, una sola vez cada una.
 *
 * No hay "deshacer": en un producto que guarda memoria de personas, revertir a
 * ciegas destruye datos. Si una migración está mal, se escribe otra que la
 * corrija. Cada archivo corre dentro de su propia transacción: o entra entero
 * o no entra.
 *
 * Uso: DATABASE_URL=... node tools/migrate.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'db/migrations')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('DATABASE_URL no está configurada en este proceso.')
    process.exitCode = 2
    return
  }

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  if (!files.length) return console.log('No hay migraciones.')

  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 20_000,
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
  })
  const client = await pool.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const { rows: applied } = await client.query('SELECT name, sha256 FROM _migrations')
    const byName = new Map(applied.map((r) => [r.name, r.sha256]))

    for (const file of files) {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8')
      // La huella se calcula con finales de línea normalizados. En Windows, Git
      // entrega estos archivos con CRLF aunque en el repositorio estén con LF:
      // sin normalizar, la misma migración cambia de huella al clonar y la
      // herramienta se bloquea sola, impidiendo aplicar cualquier migración
      // nueva. Pasó, y costó una columna que la aplicación creía tener.
      const hash = sha256(sql.replace(/\r\n/g, '\n'))
      const previous = byName.get(file)

      if (previous === hash) {
        console.log(`ya aplicada: ${file}`)
        continue
      }
      if (previous && previous !== hash) {
        // Editar una migración ya aplicada deja la base y el repositorio
        // diciendo cosas distintas. Se detiene antes de empeorarlo.
        console.error(`ABORTADO: ${file} ya se aplicó con otro contenido. Escribe una migración nueva en vez de editar esta.`)
        process.exitCode = 1
        return
      }
      if (dryRun) {
        console.log(`pendiente: ${file}`)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name, sha256) VALUES ($1, $2)', [file, hash])
        await client.query('COMMIT')
        console.log(`aplicada: ${file}`)
      } catch (error) {
        await client.query('ROLLBACK')
        console.error(`FALLÓ: ${file} — ${error instanceof Error ? error.message : 'error desconocido'}`)
        process.exitCode = 1
        return
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falló el migrador.')
  process.exitCode = 1
})
