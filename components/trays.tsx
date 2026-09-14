// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'
import { useLocale } from './locale'

import { useRef } from 'react'
import { ArrowRight, BriefcaseBusiness, Heart, House, Users, Check } from 'lucide-react'
import { TRAYS, type DomiSession, type DomiTask, type SessionAction, type Tray } from '@/lib/session'
import { Brand } from './brand'
import { ResearchBadge } from './research-badge'
import { useState } from 'react'
import { createResearch } from '@/lib/guest-client'

function TrayResearchInput({ tray, session, dispatch }: { tray: (typeof TRAYS)[number], session: DomiSession, dispatch: (action: SessionAction) => void }) {
  const { locale, t } = useLocale()
  const [blocker, setBlocker] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeResearch = session.research?.tray === tray.id ? session.research : null

  const handleResearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!blocker.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await createResearch({ contextArea: tray.color, blocker, locale })
      const data = await res.json()
      if (typeof data.runId === 'string' && (res.ok || data.dispatchState === 'unknown' || data.dispatchState === 'rejected')) {
        dispatch({ type: 'trayResearch', tray: tray.id, runId: data.runId, title: blocker.trim() })
        setBlocker('')
      } else {
        setError(data.error || t("Error al iniciar investigación"))
      }
    } catch {
      setError(t("Error de conexión"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="tray-research-dock">
      {activeResearch ? (
        <ResearchBadge 
          runId={activeResearch.runId} 
          title={activeResearch.title}
          onOpen={() => dispatch({ type: 'screen', screen: 'research', now: Date.now() })} 
        />
      ) : (
        <form onSubmit={handleResearch} className="passive-input-wrap">
          <label htmlFor={`research-input-${tray.id}`} className="passive-input-label"> {t("¿Algo te detiene en esta área?")} </label>
          <div className="passive-input-group">
            <input 
              id={`research-input-${tray.id}`}
              type="text" 
              value={blocker}
              onChange={e => setBlocker(e.target.value)}
              disabled={submitting}
              placeholder={t("Ej. ¿Cómo asigno una IP estática en Render?")}
              className="passive-input-field"
            />
            <button 
              type="submit" 
              disabled={!blocker.trim() || submitting} 
              className="passive-submit-btn"
              title={t("Aclarar con investigación en segundo plano")}
            >
              <span>{t("Aclarar")}</span>
            </button>
          </div>
          {error && <p className="tray-research-error">{error}</p>}
        </form>
      )}
    </div>
  )
}

type Props = { session: DomiSession; dispatch: (action: SessionAction) => void; retryDetail: (dumpId: string) => void }
const icons = { trabajo: BriefcaseBusiness, personal: Heart, casa: House, social: Users }

export function Trays({ session, dispatch, retryDetail }: Props) {
  const { locale, t } = useLocale()
  const openTasks = session.tasks.filter(task => !task.done)
  const selected = openTasks.find(task => task.id === session.selectedTaskId) ?? openTasks[0]
  const start = (task: DomiTask) => dispatch({ type: 'start', taskId: task.id, runId: crypto.randomUUID(), now: Date.now() })
  const first = selected?.steps.find(step => !step.done)
  const dump = session.dumps.find(item => item.id === selected?.dumpId)
  const dragged = useRef<string | null>(null)
  const completed = session.tasks.filter(task => task.done)

  return <div className="domi-shell trays-shell">
    <header className="domi-header"><Brand onClick={() => dispatch({ type: 'screen', screen: 'capture', now: Date.now() })} /><span className="badge">{t("Tus bandejas")}</span></header>
    <main>
      <h1>{t("Cada pendiente en su lugar.")}</h1>
      <p className="intro">{t("Puedes cambiar cualquiera de bandeja. Tú eliges por dónde empezar.")}</p>
      {selected ? <section className="momentum-hero" aria-label={t("Tu punto de partida")}>
        <div className="hero-eyebrow-row">
          <span className="hero-eyebrow-pill">{t("Modo Momentum · Acción Inmediata")}</span>
          <span className="hero-shield-pill">{t("Una sola cosa a la vez")}</span>
        </div>
        <h2>{selected.title}</h2>
        <p className="hero-reason">{selected.why || t("Elegida por Domi para romper la inercia y poner tu día en movimiento.")}</p>
        
        {first && (
          <div className="hero-first">
            <span className="hero-first-tag">{t("Primer movimiento ·")} {first.minutes} {t("min estimados")}</span>
            <strong>{first.title}</strong>
            {first.hook && <p>{first.hook}</p>}
          </div>
        )}

        {selected.steps.length > 1 && (
          <details className="hero-steps">
            <summary>{t("Hacerla más pequeña (")}{selected.steps.length} {t("micro-pasos disponibles)")}</summary>
            <ol>
              {selected.steps.map(step => (
                <li key={step.id}>
                  <span>{step.title}</span> {step.minutes > 0 && <small className="step-time">({step.minutes} min)</small>}
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="hero-action-row">
          <button className="hero-start" onClick={() => start(selected)}> {t("Arrancar en Dominio")} <ArrowRight size={18} />
          </button>
          <span className="hero-note">{t("Un solo toque. La misma tarea, sin empezar de nuevo.")}</span>
        </div>

        {dump?.detailStatus === 'pending' && <p className="meta hero-status" role="status">{t("Los micro-pasos se están preparando en segundo plano. Ya puedes arrancar.")}</p>}
        {dump?.detailStatus === 'failed' && <p className="meta hero-status">{t("Los micro-pasos no llegaron.")} <button className="quiet" onClick={() => retryDetail(dump.id)}>{t("Reintentar pasos")}</button></p>}
      </section> : <section className="empty-panel"><h2>{t("La mesa está libre.")}</h2><p>{t("Lo que terminaste sigue disponible abajo.")}</p></section>}

      <div className="tray-grid">
        {TRAYS.map(tray => {
          const Icon = icons[tray.color]
          const tasks = openTasks.filter(task => task.tray === tray.id)
          return <section key={tray.id} className={`tray tray-${tray.color}`} aria-label={`${t("Bandeja")} ${t(tray.name)}`}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = dragged.current; if (id) dispatch({ type: 'move', taskId: id, tray: tray.id }); dragged.current = null }}>
            <header><h2><Icon size={18} />{t(tray.name)}</h2><span className="tray-count" aria-label={`${tasks.length} ${t("pendientes")}`}>{tasks.length}</span></header>
            <div className="tray-cards">{tasks.map((task, index) => <article key={task.id} className={`task-card${selected?.id === task.id ? ' is-chosen' : ''}`} style={{ animationDelay: `${Math.min(index, 4) * 70}ms` }} draggable
              onDragStart={() => { dragged.current = task.id }} onDragEnd={() => { dragged.current = null }}>
              <button className="task-pick" onClick={() => dispatch({ type: 'choose', taskId: task.id })} aria-pressed={selected?.id === task.id}><span>{task.title}</span>{selected?.id === task.id && <small>{t("Elegida")}</small>}</button>
              <label className="move-label"><span>{t("Mover a")}</span><select value={task.tray} onChange={event => dispatch({ type: 'move', taskId: task.id, tray: event.target.value as Tray })} aria-label={`${t("Mover")} ${task.title} ${t("a otra bandeja")}`}>{TRAYS.map(destination => <option key={destination.id} value={destination.id}>{t(destination.name)}</option>)}</select></label>
            </article>)}</div>
            {!tasks.length && <p className="tray-empty">{t("Mesa libre en")} {t(tray.name)}</p>}
            <TrayResearchInput tray={tray} session={session} dispatch={dispatch} />
          </section>
        })}
      </div>
      {completed.length > 0 && <details className="completed-tasks"><summary>{completed.length} {completed.length === 1 ? t("pendiente terminado") : t("pendientes terminados")}</summary><ul>{completed.map(task => <li key={task.id}><Check size={16} />{task.title}</li>)}</ul></details>}
      <div className="tray-footer"><button className="quiet" onClick={() => dispatch({ type: 'screen', screen: 'capture', now: Date.now() })}>{t("Añadir otro vaciado")}</button><span className="meta">{openTasks.length} {t("pendientes · avance guardado en este navegador")}</span></div>
    </main>
  </div>
}
