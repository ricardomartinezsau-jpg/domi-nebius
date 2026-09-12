'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ExternalLink, RotateCw, Search, ShieldCheck } from 'lucide-react'
import type { ResearchView } from '@/lib/research'

const STEP_LABELS: Record<string, string> = {
  'question-1': '1. Formular pregunta',
  'search-1': '2. Búsqueda web',
  'gap': '3. Detectar lagunas',
  'search-2': '4. Búsqueda profunda',
  'guide': '5. Guía respaldada',
}

const STEP_ORDER = ['question-1', 'search-1', 'gap', 'search-2', 'guide']

function getDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return urlStr
  }
}

export function ResearchBlock({ runId }: { runId: string }) {
  const [view, setView] = useState<ResearchView | null>(null)

  useEffect(() => {
    let timer: NodeJS.Timeout
    const poll = async () => {
      try {
        const res = await fetch(`/api/research?runId=${runId}`)
        if (res.ok) {
          const data = await res.json()
          setView(data)
          if (data.status === 'done' || data.status === 'failed') return
        }
      } catch {}
      timer = setTimeout(poll, 2500)
    }
    poll()
    return () => clearTimeout(timer)
  }, [runId])

  if (!view) {
    return (
      <div className="research-block is-loading-init" role="status">
        <div className="research-init-spinner" aria-hidden="true" />
        <span>Conectando con el motor de investigación de Domi…</span>
      </div>
    )
  }

  const isWorking = view.status === 'queued' || view.status === 'running'
  const isDone = view.status === 'done'
  const isFailed = view.status === 'failed'

  // Detectar si algún paso está en reintento o recuperándose (Render Workflows)
  const recoveringStep = view.steps.find(s => s.attempt > 1 || (s.status === 'failed' && isWorking))
  const currentStepIndex = view.currentStep ? STEP_ORDER.indexOf(view.currentStep) : -1

  return (
    <section className="research-block" aria-label="Investigación de apoyo">
      {/* Cabecera del bloque */}
      <header className="research-header">
        <div className="research-title-group">
          <Search size={17} className="research-icon" />
          <h3 className="research-title">Investigación profunda de apoyo</h3>
        </div>
        <span className={`research-status-badge status-${view.status}`}>
          {isWorking && 'Investigando (1–3 min)'}
          {isDone && 'Completada'}
          {isFailed && 'Pausada por error'}
        </span>
      </header>

      {/* ESTADO 2: RECUPERÁNDOSE (Render Workflows Auto-Recovery) */}
      {recoveringStep && (
        <div className="research-recovery-box" role="status">
          <div className="recovery-badge-row">
            <RotateCw size={14} className="recovery-spin" />
            <span className="recovery-tag">Render Workflows · Resiliencia Activa</span>
          </div>
          <strong>
            Paso «{STEP_LABELS[recoveringStep.step] || recoveringStep.step}» en auto-recuperación (Intento {recoveringStep.attempt})
          </strong>
          <p>
            Un intento previo tuvo un corte o demora. El workflow se reanuda de forma segura desde este punto sin duplicar búsquedas ni perder el avance previo.
          </p>
        </div>
      )}

      {/* ESTADO 1: ESPERANDO (Proceso asíncrono largo de 1 a 3 minutos) */}
      {isWorking && (
        <div className="research-waiting-panel" role="status">
          <p className="waiting-advice">
            Esta investigación toma entre 1 y 3 minutos en segundo plano. Puedes regresar a tus bandejas o continuar con otra tarea; tu avance se guarda y te esperará aquí.
          </p>

          {/* Línea de etapas de Render Workflows */}
          <div className="research-pipeline" aria-label="Etapas de investigación">
            {STEP_ORDER.map((stepKey, idx) => {
              const isPast = currentStepIndex > idx
              const isCurrent = currentStepIndex === idx
              return (
                <div
                  key={stepKey}
                  className={`pipeline-node ${isPast ? 'is-past' : ''} ${isCurrent ? 'is-current' : ''}`}
                >
                  <span className="node-dot" />
                  <span className="node-label">{STEP_LABELS[stepKey]}</span>
                </div>
              )
            })}
          </div>

          {/* Preguntas activas que Domi está resolviendo */}
          {view.questions.length > 0 && (
            <div className="research-active-questions">
              <span className="active-questions-label">Preguntas en indagación activa:</span>
              <ul>
                {view.questions.map((q, i) => (
                  <li key={i}>
                    <strong>{q.question}</strong>
                    {q.askedBecause && <small> — {q.askedBecause}</small>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ESTADO 3 Y 4: RESULTADOS CON FUENTES Y LO SIN CONFIRMAR */}
      {isDone && view.guide && (
        <div className="research-results">
          {/* Micro-pasos fundamentados */}
          {view.guide.steps.length > 0 && (
            <div className="guide-steps-container">
              <h4 className="guide-subtitle">Guía de acción respaldada con fuentes</h4>
              <ol className="guide-steps-list">
                {view.guide.steps.map((step, idx) => (
                  <li key={idx} className="guide-step-item">
                    <div className="step-content">
                      <strong className="step-title">{step.title}</strong>
                      <p className="step-detail">{step.detail}</p>
                    </div>

                    {/* ESTADO 3: CON FUENTES CITADAS Y ENLACES */}
                    {step.sourceUrls && step.sourceUrls.length > 0 && (
                      <div className="step-citations">
                        <span className="citations-label">Fuentes verificadas:</span>
                        <div className="citations-pills">
                          {step.sourceUrls.map((url, uIdx) => {
                            const foundSource = view.sources.find(s => s.url === url)
                            const domain = getDomain(url)
                            const label = foundSource?.name || domain
                            return (
                              <a
                                key={uIdx}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="citation-pill"
                                title={url}
                              >
                                <span>{label}</span>
                                {foundSource?.confidence && (
                                  <span className={`confidence-tag conf-${foundSource.confidence}`}>
                                    {foundSource.confidence}
                                  </span>
                                )}
                                <ExternalLink size={12} />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ESTADO 4: SIN CONFIRMAR (Diferenciación rigurosa de hechos) */}
          {(view.guide.unconfirmed.length > 0 || view.guide.disagreement) && (
            <div className="research-unconfirmed-box">
              <div className="unconfirmed-header">
                <AlertCircle size={16} />
                <strong>Sin confirmar con fuentes fidedignas</strong>
              </div>
              <p className="unconfirmed-note">
                Lo que la investigación no logró corroborar plenamente en las fuentes encontradas. No es un fallo: es la diferencia entre informar con rigor y adivinar. Tómalo con criterio propio:
              </p>
              <ul className="unconfirmed-items">
                {view.guide.unconfirmed.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              {view.guide.disagreement && (
                <div className="disagreement-box">
                  <strong>Contradicción detectada entre fuentes:</strong>
                  <p>{view.guide.disagreement}</p>
                </div>
              )}
            </div>
          )}

          {/* Resumen de fuentes consultadas */}
          {view.sources.length > 0 && (
            <details className="research-sources-details">
              <summary>
                <ShieldCheck size={14} />
                <span>Ver las {view.sources.length} fuentes consultadas durante el proceso</span>
              </summary>
              <ul className="all-sources-list">
                {view.sources.map((src, i) => (
                  <li key={i}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.name || getDomain(src.url)}
                    </a>
                    <span className="source-meta">({src.confidence} confianza · Ronda {src.round})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Manejo de error terminal si ocurrió */}
      {isFailed && (
        <div className="research-failed-box">
          <p>
            {view.error || 'La investigación no pudo completarse. Tu tarea y notas siguen intactas.'}
          </p>
        </div>
      )}
    </section>
  )
}
