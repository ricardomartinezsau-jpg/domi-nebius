'use client'
import { useLocale } from './locale'

import { AlertCircle, ExternalLink, Plus, Check, RotateCw, Search, ShieldCheck } from 'lucide-react'
import { useResearch } from './use-research'
import { useState } from 'react'
import { resumeResearch } from '@/lib/guest-client'

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
  const { locale, t } = useLocale()
  const [refresh, setRefresh] = useState(0)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const { view, error } = useResearch(runId, refresh)
  const [addedTasks, setAddedTasks] = useState<Set<string>>(new Set())
  const resume = async () => {
    if (resuming) return
    setResuming(true); setResumeError(null)
    try {
      const response = await resumeResearch(runId)
      const data = await response.json()
      if (!response.ok) setResumeError(data.error ?? t("No se confirmó la aceptación. No se enviará otra ejecución automáticamente."))
      setRefresh(value => value + 1)
    } catch { setResumeError(t("No se confirmó el envío. Tu investigación se conserva; no hemos creado otra.")) }
    finally { setResuming(false) }
  }

  const handleAdd = (title: string) => {
    if (onConvertToTask) {
      onConvertToTask(title)
      setAddedTasks(prev => new Set(prev).add(title))
    }
  }

  if (!view) {
    return (
      <div className="research-block is-loading-init" role="status">
        {!error && <div className="research-init-spinner" aria-hidden="true" />}
        <span>{error ? t(error) : t("Consultando tu investigación…")}</span>
      </div>
    )
  }

  const isUncertain = ['unknown', 'sending'].includes(view.dispatchState ?? '')
  const isWorking = !isUncertain && (view.status === 'queued' || view.status === 'running')
  const isDone = view.status === 'done'
  const isFailed = view.status === 'failed'

  // Detectar si algún paso está en reintento o recuperándose (Render Workflows)
  const recoveringStep = isWorking && view.steps.find(s => s.status === 'running' && s.attempt > 1)
  const currentStepIndex = view.currentStep ? STEP_ORDER.indexOf(view.currentStep) : -1

  return (
    <section className="research-block" aria-label={t("Investigación de apoyo")}>
      {error && <p role="status">{t(error)} {t("El resultado anterior se conserva.")}</p>}
      {resumeError && <p role="alert">{t(resumeError)}</p>}
      {isUncertain && <p role="status">{t("La entrega al ejecutor no está confirmada. Conservamos esta investigación; requiere revisión operativa antes de reenviarla.")}</p>}
      {view.canResume && <button className="quiet" disabled={resuming} onClick={resume}>{resuming ? t("Comprobando…") : t("Reanudar investigación")}</button>}
      {/* Cabecera del bloque */}
      <header className="research-header">
        <div className="research-title-group">
          <Search size={17} className="research-icon" />
          <h2 className="research-title">{t("Fuentes y guía")}</h2>
        </div>
        <span className={`research-status-badge status-${view.status}`}>
          {isUncertain && t("Entrega por confirmar")}
          {isWorking && t("Investigando fuentes…")}
          {isDone && t("Listo para revisión")}
          {isFailed && t("Pausada por error")}
        </span>
      </header>

      {/* ESTADO 2: RECUPERÁNDOSE (Render Workflows Auto-Recovery) */}
      {recoveringStep && (
        <div className="research-recovery-box" role="status">
          <div className="recovery-badge-row">
            <RotateCw size={14} className="recovery-spin" />
            <span className="recovery-tag">{t("Retomando un paso")}</span>
          </div>
          <strong> {t("Paso «")}{t(STEP_LABELS[recoveringStep.step] || recoveringStep.step)}{t("» en auto-recuperación (Intento")} {recoveringStep.attempt})
          </strong>
          <p> {t("Un intento previo tuvo un corte o demora. Los pasos ya guardados se conservan.")} </p>
        </div>
      )}

      {/* El tiempo observado no es una promesa de duración para todas las consultas. */}
      {isWorking && (
        <div className="research-waiting-panel" role="status">
          <p className="waiting-advice"> {t("Puedes volver a tus bandejas o bloquear el teléfono. La investigación sigue por su cuenta; al volver consultaremos el resultado guardado.")} </p>

          {/* Línea de etapas de Render Workflows */}
          <div className="research-pipeline" aria-label={t("Etapas de investigación")}>
            {STEP_ORDER.map((stepKey, idx) => {
              const isPast = currentStepIndex > idx
              const isCurrent = currentStepIndex === idx
              return (
                <div
                  key={stepKey}
                  className={`pipeline-node ${isPast ? 'is-past' : ''} ${isCurrent ? 'is-current' : ''}`}
                >
                  <span className="node-dot" />
                  <span className="node-label">{t(STEP_LABELS[stepKey])}</span>
                </div>
              )
            })}
          </div>

          {/* Preguntas activas que Domi está resolviendo */}
          {view.questions.length > 0 && (
            <div className="research-active-questions">
              <span className="active-questions-label">{t("Preguntas en indagación activa:")}</span>
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
              <h4 className="guide-subtitle">{t("Guía de acción respaldada con fuentes")}</h4>
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
                          title={addedTasks.has(step.title) ? t("Paso añadido a tu bandeja") : t("Convertir este paso en una tarea de tu bandeja")}
                        >
                          {addedTasks.has(step.title) ? (
                            <>
                              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                              <span>{t("Añadido")}</span>
                            </>
                          ) : (
                            <>
                              <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                              <span>{t("A la bandeja")}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* ESTADO 3: CON FUENTES CITADAS Y ENLACES */}
                    {step.sourceUrls && step.sourceUrls.length > 0 && (
                      <div className="step-citations">
                        <span className="citations-label">{t("Fuentes citadas:")}</span>
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
                    <strong>{t("Sin confirmar con fuentes fidedignas")}</strong>
                  </div>
                  <p className="unconfirmed-note"> {t("Lo que la investigación no logró corroborar plenamente en las fuentes encontradas. No es un fallo: es la diferencia entre informar con rigor y adivinar. Tómalo con criterio propio:")} </p>
                  <ul className="unconfirmed-items">
                    {view.guide.unconfirmed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </>
              )}

              {/* CONTRADICCIONES CRÍTICAS (Esto no me cuadra) — Sin alarma roja ni pánico */}
              {view.guide.disagreement && (
                <div className="contradiction-box" aria-label={t("Contradicción detectada entre fuentes")}>
                  <div className="contradiction-header">
                    <span className="contradiction-badge">{t("Transparencia Documental")}</span>
                    <strong className="contradiction-title">{t("Esto no me cuadra (contradicción detectada entre fuentes):")}</strong>
                  </div>
                  <p className="contradiction-body">{view.guide.disagreement}</p>
                  <div className="contradiction-sovereignty-note">
                    <ShieldCheck size={14} />
                    <span>{t("Domi no toma partido a ciegas: te mostramos la discrepancia para que decidas con los hechos verificados.")}</span>
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
                <span>{t("Ver las")} {view.sources.length} {t("fuentes consultadas durante el proceso")}</span>
              </summary>
              <ul className="all-sources-list">
                {view.sources.map((src, i) => (
                  <li key={i}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.name || getDomain(src.url)}
                    </a>
                    <span className="source-meta">{t("Consulta")} {src.round}</span>
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
          <p> {t("La investigación no pudo completarse. Tu tarea, notas y resultados guardados se conservan.")} {view.error && <small>{t("Referencia:")} {t(view.error)}</small>}
          </p>
        </div>
      )}
    </section>
  )
}
