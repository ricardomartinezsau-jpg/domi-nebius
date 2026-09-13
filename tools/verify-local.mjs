/** Compile with synthetic process configuration. Never import .env.local credentials.
 * Next still reads env files; every declared key is shadowed before it starts.
 * This is NOT a production build or a validation of the live database schema.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2]
if (!['build', 'typecheck'].includes(command)) throw new Error('Usage: node tools/verify-local.mjs build|typecheck')
const env = { ...process.env }
for (const name of fs.readdirSync(root).filter(name => /^\.env($|\.)/.test(name))) {
  if (!fs.statSync(path.join(root, name)).isFile()) continue
  for (const match of fs.readFileSync(path.join(root, name), 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = ''
}
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DOMI_ADMISSION_ENABLED: 'false',
  DATABASE_URL: 'postgresql://domi_test:synthetic@127.0.0.1:1/domi_test_build', DATABASE_SSL: '',
  BETTER_AUTH_SECRET: 'synthetic-build-secret-never-use-in-production', BETTER_AUTH_URL: 'http://localhost:3000',
  NEBIUS_API_KEY: '', LINKUP_API_KEY: '', RENDER_API_KEY: '', NEBIUS_MODEL: '', NEBIUS_RESEARCH_MODEL: '',
})
const args = command === 'build' ? ['node_modules/next/dist/bin/next', 'build'] : ['node_modules/typescript/bin/tsc', '--noEmit']
const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
child.on('error', () => { console.error('Local verification could not start'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
