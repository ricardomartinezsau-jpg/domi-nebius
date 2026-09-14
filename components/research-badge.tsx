// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'
import { useLocale } from './locale'

import { Check, ArrowRight } from 'lucide-react'
import { useResearch } from './use-research'

export function ResearchBadge({ 
  runId, 
  title, 
  onOpen 
}: { 
  runId: string
  title?: string
  onOpen: () => void 
}) {
  const { locale, t } = useLocale()
  const { view, error } = useResearch(runId)

  // Estado con error técnico
  if (error || view?.status === 'failed') {
    return (
      <button type="button" className="research-tray-badge is-failed" onClick={onOpen}>
        <span className="failed-title">{t("Investigación pausada")}</span>
        <span className="failed-note">{t("Toca para revisar el estado")}</span>
      </button>
    )
  }

  // Estado 3: Listo (Badge finalizado invita a entrar)
  if (view?.status === 'done') {
    const stepsCount = view.guide?.steps.length ?? 0
    const hasDisagreement = Boolean(view.guide?.disagreement)
    return (
      <button 
        type="button" 
        className="research-tray-badge is-done" 
        onClick={onOpen}
        title={t("Ver guía fundamentada y fuentes de la investigación")}
      >
        <div className="done-header">
          <div className="done-tag-group">
            <span className="done-badge-check" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
            <span className="done-title">{t("Investigación lista para revisión")}</span>
          </div>
          <span className="done-arrow" aria-hidden="true">{t("Abrir")} <ArrowRight size={13} style={{ display: 'inline', verticalAlign: '-1px' }} /></span>
        </div>
        <p className="done-summary">
          {title ? `«${title.slice(0, 32)}${title.length > 32 ? '…' : ''}»: ` : ''}
          {stepsCount > 0 ? `${stepsCount} ${stepsCount === 1 ? t("paso fundamentado") : t("pasos fundamentados")}` : t("Hallazgos listos")}
          {hasDisagreement ? t(" · 1 contradicción detectada") : ''}
        </p>
      </button>
    )
  }

  // Estado 2: Procesando (Pulso sereno de tinta viva sin spinner genérico)
  return (
    <div className="research-tray-badge is-processing" role="status" aria-live="polite">
      <div className="processing-top">
        <div className="processing-indicator">
          <div className="ink-pulse-ring" aria-hidden="true">
            <div className="ink-pulse-halo" />
            <div className="ink-pulse-core" />
          </div>
          <span className="processing-title">{t("Averiguando fuentes con Linkup")}</span>
        </div>
        <span className="processing-time-pill">~20s</span>
      </div>
      <p className="processing-calm-note"> {t("Puedes seguir ordenando tareas o salir. Al terminar te avisamos aquí.")} </p>
      <div className="ink-progress-track" aria-hidden="true">
        <div className="ink-progress-bar" />
      </div>
    </div>
  )
}

