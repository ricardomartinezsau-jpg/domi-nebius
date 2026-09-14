// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
/** Isolated graph: unmocked network and database access fail loudly. No dotenv. */
export function loader(mocks = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    const relative = path.relative(root, file).replaceAll('\\', '/')
    if (Object.hasOwn(mocks, relative)) return mocks[relative]
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const resolve = id => {
      if (!id.startsWith('.') && !id.startsWith('@/')) {
        if (Object.hasOwn(mocks, id)) return mocks[id]
        if (id === 'pg') throw new Error('Unmocked PostgreSQL access prohibited in isolated tests')
        return require(id)
      }
      let target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id)
      if (!path.extname(target)) target += '.ts'
      return load(target)
    }
    vm.runInNewContext(code, { module, exports: module.exports, require: resolve, console,
      Error, TypeError, SyntaxError, Date, Buffer, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, AbortSignal, performance, setTimeout, clearTimeout,
      process: { env: { NODE_ENV: 'test', DOMI_ADMISSION_ENABLED: 'true', BETTER_AUTH_SECRET: 'synthetic-secret-with-more-than-thirty-two-characters', BETTER_AUTH_URL: 'https://domi.test' } },
      fetch: () => { throw new Error('Unmocked network prohibited') }, ...globals }, { filename: file })
    return module.exports
  }
  return file => load(path.resolve(root, file))
}
