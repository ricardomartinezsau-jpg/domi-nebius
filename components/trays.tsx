'use client'

import { useRef } from 'react'
import { ArrowRight, BriefcaseBusiness, Heart, House, Users, Check } from 'lucide-react'
import { TRAYS, type DomiSession, type DomiTask, type SessionAction, type Tray } from '@/lib/session'
import { Brand } from './brand'

type Props = { session: DomiSession; dispatch: (action: SessionAction) => void; retryDetail: (dumpId: string) => void }
const icons = { trabajo: BriefcaseBusiness, personal: Heart, casa: House, social: Users }

export function Trays({ session, dispatch, retryDetail }: Props) {
  const openTasks = session.tasks.filter(task => !task.done)
  const selected = openTasks.find(task => task.id === session.selectedTaskId) ?? openTasks[0]
  const start = (task: DomiTask) => dispatch({ type: 'start', taskId: task.id, runId: crypto.randomUUID(), now: Date.now() })
  const first = selected?.steps.find(step => !step.done)
  const dump = session.dumps.find(item => item.id === selected?.dumpId)
  const dragged = useRef<string | null>(null)
  const completed = session.tasks.filter(task => task.done)

  return <div className="domi-shell trays-shell">
    <header className="domi-header"><Brand /><span className="badge">Tus bandejas</span></header>
    <main>
      <h1>Cada pendiente en su lugar.</h1>
      <p className="intro">Puedes cambiar cualquiera de bandeja. Tú eliges por dónde empezar.</p>
      {selected ? <section className="momentum-hero" aria-label="Tu punto de partida">
        <div className="hero-eyebrow-row">
          <span className="hero-eyebrow-pill">Modo Momentum · Acción Inmediata</span>
          <span className="hero-shield-pill">Una sola cosa a la vez</span>
        </div>
        <h2>{selected.title}</h2>
        <p className="hero-reason">{selected.why || 'Elegida por Domi para romper la inercia y poner tu día en movimiento.'}</p>
        
        {first && (
          <div className="hero-first">
            <span className="hero-first-tag">Primer movimiento · {first.minutes} min estimados</span>
            <strong>{first.title}</strong>
            {first.hook && <p>{first.hook}</p>}
          </div>
        )}

        {selected.steps.length > 1 && (
          <details className="hero-steps">
            <summary>Hacerla más pequeña ({selected.steps.length} micro-pasos disponibles)</summary>
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
          <button className="hero-start" onClick={() => start(selected)}>
            Arrancar en Dominio <ArrowRight size={18} />
          </button>
          <span className="hero-note">Un solo toque. La misma tarea, sin empezar de nuevo.</span>
        </div>

        {dump?.detailStatus === 'pending' && <p className="meta hero-status" role="status">Los micro-pasos se están preparando en segundo plano. Ya puedes arrancar.</p>}
        {dump?.detailStatus === 'failed' && <p className="meta hero-status">Los micro-pasos no llegaron. <button className="quiet" onClick={() => retryDetail(dump.id)}>Reintentar pasos</button></p>}
      </section> : <section className="empty-panel"><h2>La mesa está libre.</h2><p>Lo que terminaste sigue disponible abajo.</p></section>}

      <div className="tray-grid">
        {TRAYS.map(tray => {
          const Icon = icons[tray.color]
          const tasks = openTasks.filter(task => task.tray === tray.id)
          return <section key={tray.id} className={`tray tray-${tray.color}`} aria-label={`Bandeja ${tray.name}`}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = dragged.current; if (id) dispatch({ type: 'move', taskId: id, tray: tray.id }); dragged.current = null }}>
            <header><h2><Icon size={18} />{tray.name}</h2><span className="tray-count" aria-label={`${tasks.length} pendientes`}>{tasks.length}</span></header>
            <div className="tray-cards">{tasks.map((task, index) => <article key={task.id} className={`task-card${selected?.id === task.id ? ' is-chosen' : ''}`} style={{ animationDelay: `${Math.min(index, 4) * 70}ms` }} draggable
              onDragStart={() => { dragged.current = task.id }} onDragEnd={() => { dragged.current = null }}>
              <button className="task-pick" onClick={() => dispatch({ type: 'choose', taskId: task.id })} aria-pressed={selected?.id === task.id}><span>{task.title}</span>{selected?.id === task.id && <small>Elegida</small>}</button>
              <label className="move-label"><span>Mover a</span><select value={task.tray} onChange={event => dispatch({ type: 'move', taskId: task.id, tray: event.target.value as Tray })} aria-label={`Mover ${task.title} a otra bandeja`}>{TRAYS.map(destination => <option key={destination.id} value={destination.id}>{destination.name}</option>)}</select></label>
            </article>)}</div>
            {!tasks.length && <p className="tray-empty">Mesa libre en {tray.name}</p>}
          </section>
        })}
      </div>
      {completed.length > 0 && <details className="completed-tasks"><summary>{completed.length} {completed.length === 1 ? 'pendiente terminado' : 'pendientes terminados'}</summary><ul>{completed.map(task => <li key={task.id}><Check size={16} />{task.title}</li>)}</ul></details>}
      <div className="tray-footer"><button className="quiet" onClick={() => dispatch({ type: 'screen', screen: 'capture', now: Date.now() })}>Añadir otro vaciado</button><span className="meta">{openTasks.length} pendientes · avance guardado en este navegador</span></div>
    </main>
  </div>
}
