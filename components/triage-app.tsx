'use client'

import { useState } from 'react'
import type { TriageOutput } from '@/lib/triage'
import { TriageResult } from './triage-result'

const MAX_CHARS = 4000

export function TriageApp() {
  const [rawDump, setRawDump] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TriageOutput | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    const trimmed = rawDump.trim()
    if (!trimmed) {
      setError('Escribe algo antes de enviarlo.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawDump: trimmed, locale: 'es' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Algo salió mal. Intenta de nuevo.')
        return
      }
      setResult(data.output as TriageOutput)
    } catch {
      setError('No se pudo conectar. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor="rawDump" style={{ display: 'none' }}>
          Vaciado mental
        </label>
        <textarea
          id="rawDump"
          value={rawDump}
          maxLength={MAX_CHARS}
          onChange={(e) => setRawDump(e.target.value)}
          placeholder="Escribe todo lo que tienes en la cabeza, sin ordenar ni filtrar..."
          disabled={loading}
        />
        <div className="counter">
          {rawDump.length}/{MAX_CHARS}
        </div>
        <button type="submit" disabled={loading || !rawDump.trim()}>
          {loading ? 'Procesando…' : 'Soltar y ordenar'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      {result && <TriageResult output={result} />}
    </>
  )
}
