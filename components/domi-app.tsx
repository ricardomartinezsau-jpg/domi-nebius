'use client'

import { useState } from 'react'
import type { DetailOutput, QuickOutput } from '@/lib/triage'
import { BrainDump } from './brain-dump'

/**
 * Cascarón del producto mientras se diseñan Foco y Plan pantalla por pantalla.
 * Lo único terminado aquí es el vaciado; lo que se muestra después del
 * resultado es provisional a propósito y está marcado como tal.
 */
export function DomiApp() {
  const [dumpOpen, setDumpOpen] = useState(false)
  const [quick, setQuick] = useState<QuickOutput | null>(null)
  const [detail, setDetail] = useState<DetailOutput | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function handleQuickResult(output: QuickOutput, rawDump: string) {
    setQuick(output)
    setDetail(null)
    setDetailError(null)
    setDumpOpen(false)

    // La segunda fase arranca sola: la persona ya tiene con qué moverse.
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'detail', rawDump, locale: 'es', quick: output }),
      })
      const data = await response.json()
      if (!response.ok) {
        setDetailError(data.error ?? 'No se pudo armar el plan completo.')
        return
      }
      setDetail(data.output as DetailOutput)
    } catch {
      setDetailError('No se pudo armar el plan completo.')
    }
  }

  return (
    <main className="page">
      {!quick && (
        <>
          <h1 className="t-voice">Haz lugar para una cosa.</h1>
          <p className="note">
            Suelta lo que traes en la cabeza y Domi lo reparte, lo ordena y te da por dónde
            empezar. Sin cuenta funciona igual; con cuenta, recuerda lo de la vez pasada.
          </p>
          <button type="button" className="action" onClick={() => setDumpOpen(true)}>
            Soltar lo que traigo
          </button>
        </>
      )}

      {quick && (
        <>
          <section className="panel" aria-label="Empieza por aquí">
            <p className="t-eyebrow">Empieza por aquí · 2–5 min</p>
            <p className="t-voice">{quick.momentumMode.activationHook}</p>
            <div className="inset" style={{ marginTop: 'var(--s4)' }}>
              <span className="t-meta">Hoy ignora lo demás: </span>
              <span className="t-read">{quick.momentumMode.singleFocusShield}</span>
            </div>
          </section>

          {!detail && !detailError && (
            <div className="sweep" role="status" aria-live="polite">
              Armando el plan completo
            </div>
          )}
          {detailError && <p className="error">{detailError}</p>}
          {detail && (
            <section className="panel" aria-label="El plan">
              <p className="t-eyebrow">Provisional — pendiente de diseño</p>
              <ol>
                {detail.dependencyOrder.map((step) => (
                  <li key={step.step} className="t-read">
                    {step.task}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <button type="button" className="link-quiet" onClick={() => setQuick(null)}>
            Empezar de nuevo
          </button>
        </>
      )}

      <BrainDump open={dumpOpen} onClose={() => setDumpOpen(false)} onQuickResult={handleQuickResult} />
    </main>
  )
}
