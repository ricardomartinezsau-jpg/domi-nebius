'use client'

import { AlertCircle, ExternalLink, Plus, Check, RotateCw, Search, ShieldCheck } from 'lucide-react'
import { useResearch } from './use-research'
import { useState } from 'react'

const STEP_LABELS: Record<string, string> = {
  'question-1': '1. Formular pregunta',
  'search-1': '2. Búsqueda web',
  'gap': '3. Detectar lagunas',
  'search-2': '4. Búsqueda de seguimiento',
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

export function ResearchBlock({ runId, onConvertToTask }: { runId: string, onConvertToTask?: (title: string) => void }) {
  const { view, error } = useResearch(runId)
  const [addedTasks, setAddedTasks] = useState<Set<string>>(new Set())

  const handleAdd = (title: string) => {
    if (onConvertToTask) {
      onConvertToTask(title)
      setAddedTasks(prev => new Set(prev).add(title))
    }
  }

  if (!view) {
    return (
      <div className="research-block is-loading-init" role="status">
        <div className="research-init-spinner" aria-hidden="true" />
        <span>{error || 'Consultando tu investigación…'}</span>
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
      {error && <p role="status">{error} El resultado anterior se conserva.</p>}
      {/* Cabecera del bloque */}
      <header className="research-header">
        <div className="research-title-group">
          <Search size={17} className="research-icon" />
          <h2 className="research-title">Fuentes y guía</h2>
        </div>
        <span className={`research-status-badge status-${view.status}`}>
          {isWorking && 'Investigando fuentes…'}
          {isDone && 'Listo para revisión'}
          {isFailed && 'Pausada por error'}
        </span>
      </header>

      {/* ESTADO 2: RECUPERÁNDOSE (Render Workflows Auto-Recovery) */}
      {recoveringStep && (
        <div className="research-recovery-box" role="status">
          <div className="recovery-badge-row">
            <RotateCw size={14} className="recovery-spin" />
            <span className="recovery-tag">Retomando un paso</span>
          </div>
          <strong>
            Paso «{STEP_LABELS[recoveringStep.step] || recoveringStep.step}» en auto-recuperación (Intento {recoveringStep.attempt})
          </strong>
          <p>
            Un intento previo tuvo un corte o demora. Los pasos ya guardados se conservan.
          </p>
        </div>
      )}

      {/* El tiempo observado no es una promesa de duración para todas las consultas. */}
      {isWorking && (
        <div className="research-waiting-panel" role="status">
          <p className="waiting-advice">
            Puedes volver a tus bandejas o bloquear el teléfono. La investigación sigue por su cuenta; al volver consultaremos el resultado guardado.
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
                    <div className="step-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong className="step-title">{step.title}</strong>
                        <p className="step-detail">{step.detail}</p>
                      </div>
                      {onConvertToTask && (
                        <button 
                          type="button"
                          className={`btn-convert-task ${addedTasks.has(step.title) ? 'is-added' : ''}`}
                          onClick={() => handleAdd(step.title)} 
                          disabled={addedTasks.has(step.title)}
                          title={addedTasks.has(step.title) ? 'Paso añadido a tu bandeja' : 'Convertir este paso en una tarea de tu bandeja'}
                        >
                          {addedTasks.has(step.title) ? (
                            <>
                              <Check size={14} strokeWidth={2.8} />
                              <span>✓ Añadido</span>
                            </>
                          ) : (
                            <>
                              <Plus size={14} strokeWidth={2.5} />
                              <span>＋ A la bandeja</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* ESTADO 3: CON FUENTES CITADAS Y ENLACES */}
                    {step.sourceUrls && step.sourceUrls.length > 0 && (
                      <div className="step-citations">
                        <span className="citations-label">Fuentes citadas:</span>
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
              {view.guide.unconfirmed.length > 0 && (
                <>
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
                </>
              )}

              {/* CONTRADICCIONES CRÍTICAS (Esto no me cuadra) — Sin alarma roja ni pánico */}
              {view.guide.disagreement && (
                <div className="contradiction-box" aria-label="Contradicción detectada entre fuentes">
                  <div className="contradiction-header">
                    <span className="contradiction-badge">Transparencia Documental</span>
                    <strong className="contradiction-title">Esto no me cuadra (contradicción detectada entre fuentes):</strong>
                  </div>
                  <p className="contradiction-body">{view.guide.disagreement}</p>
                  <div className="contradiction-sovereignty-note">
                    <ShieldCheck size={14} />
                    <span>Domi no toma partido a ciegas: te mostramos la discrepancia para que decidas con los hechos verificados.</span>
                  </div>
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
                    <span className="source-meta">Consulta {src.round}</span>
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
