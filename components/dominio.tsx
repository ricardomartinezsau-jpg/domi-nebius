'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Pause, Play, RotateCcw } from 'lucide-react'
import { activeRun, elapsedMs, type DomiSession, type SessionAction } from '@/lib/session'
import { Brand } from './brand'

type Props = { session: DomiSession; dispatch: (action: SessionAction) => void; retryDetail: (dumpId: string) => void }
export function Dominio({ session, dispatch, retryDetail }: Props) {
  const task = session.tasks.find(item => item.id === session.selectedTaskId)
  const run = activeRun(session)
  const [now, setNow] = useState(Date.now)
  const [researching, setResearching] = useState(false)
  const [blocker, setBlocker] = useState('')
  const [submittingBlocker, setSubmittingBlocker] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const submitting = useRef(false)
  
  const heading = useRef<HTMLHeadingElement>(null)
  
  const handleResearch = async () => {
    if (!task || !blocker.trim() || submitting.current) return
    submitting.current = true
    setSubmittingBlocker(true)
    setResearchError(null)
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle: task.title, blocker })
      })
      const data = await res.json()
      if (res.status === 202 && typeof data.runId === 'string') {
        const { runId } = data
        dispatch({ type: 'research', taskId: task.id, runId })
        setResearching(false)
        setBlocker('')
      } else setResearchError(data.error || 'No se pudo abrir la investigación.')
    } catch {
      setResearchError('No se pudo confirmar el envío. No se ha repetido la petición.')
    } finally {
      submitting.current = false
      setSubmittingBlocker(false)
    }
  }

  useEffect(() => { heading.current?.focus(); const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer) }, [])
  if (!task || !run) return null
  const seconds = Math.floor(elapsedMs(run, now) / 1000)
  const minutes = Math.floor(seconds / 60)
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const pending = task.steps.find(step => !step.done)
  const dump = session.dumps.find(item => item.id === task.dumpId)
  const doneSteps = task.steps.filter(step => step.done).length
  const act = (type: 'pause' | 'resume' | 'leave' | 'finish' | 'stop') => { const time = Date.now(); setNow(time); dispatch({ type, now: time }) }
  return <div className="dominio-page"><div className="domi-shell dominio-shell">
    <header className="domi-header"><Brand /><span className="badge">Dominio · una cosa en movimiento</span></header>
    <main className="dominio-main">
      <article className="dominio-card">
        <p className="eyebrow">{task.done ? 'Una cosa menos en la mesa' : 'Sigue con esta acción'}</p>
        <h1 ref={heading} tabIndex={-1}>{task.title}</h1>
        {task.done ? <div className="dominio-complete" role="status"><Check size={28} /><h2>Hecho.</h2><p>Registraste {clock} en esta sesión. Tu tarea quedó marcada como terminada.</p><button className="primary" onClick={() => act('leave')}>Volver a la mesa</button></div> : <>
          {pending && <div className="current-action"><span className="meta">Ahora · paso {doneSteps + 1} de {task.steps.length}</span><h2>{pending.title}</h2><p>{pending.hook}</p></div>}
          {!pending && task.steps.length > 0 && <p className="meta">Los pasos están marcados. Tú decides cuándo está terminada la tarea.</p>}
          {!task.steps.length && <p className="meta">{dump?.detailStatus === 'pending' ? 'Puedes empezar. Los pasos llegarán aquí sin interrumpir tu sesión.' : 'Trabaja en esta tarea a tu ritmo.'}</p>}
          <div className={`focus-clock${session.clockVisible ? '' : ' is-collapsed'}`}>
            <div className="clock-top">
              <div className="clock-label-group">
                <span className={`clock-pulse-dot${run.activeSince !== null ? ' is-active' : ''}`} aria-hidden="true" />
                <span>{run.activeSince === null ? 'Sesión en pausa' : 'Tiempo transcurrido'}</span>
              </div>
              <label className="clock-switch">
                <span className="switch-text">{session.clockVisible ? 'Visible' : 'Oculto'}</span>
                <input type="checkbox" role="switch" checked={session.clockVisible} onChange={() => dispatch({ type: 'clockVisible' })} />
                <span className="switch-slider" aria-hidden="true" />
              </label>
            </div>
            <div className="clock-collapsible">
              <div className="clock-digits" aria-label={`${minutes} minutos y ${seconds % 60} segundos registrados`}>{clock}</div>
              <div className="clock-controls">
                <button className="quiet" onClick={() => act(run.activeSince === null ? 'resume' : 'pause')}>
                  {run.activeSince === null ? <Play size={16} /> : <Pause size={16} />}
                  {run.activeSince === null ? 'Reanudar' : 'Pausar'}
                </button>
                <button className="quiet" onClick={() => { const time = Date.now(); setNow(time); dispatch({ type: 'resetClock', runId: crypto.randomUUID(), now: time }) }}>
                  <RotateCcw size={15} />Nuevo tramo
                </button>
              </div>
              <p className="clock-note">Registrando tiempo con calma, sin cuenta regresiva.</p>
            </div>
          </div>
          {task.steps.length > 0 && <fieldset className="focus-steps"><legend>Micro-pasos de apoyo</legend>{task.steps.map(step => <label key={step.id} className={step.done ? 'step is-done' : 'step'}><input type="checkbox" checked={step.done} onChange={() => dispatch({ type: 'step', taskId: task.id, stepId: step.id })} /><span>{step.title}</span></label>)}</fieldset>}
          {dump?.detailStatus === 'failed' && <p className="meta">Los pasos no llegaron. <button className="quiet" onClick={() => retryDetail(dump.id)}>Reintentar pasos</button></p>}
          <div className="dominio-actions">{pending ? <button className="primary" onClick={() => dispatch({ type: 'step', taskId: task.id, stepId: pending.id })}><Check size={18} />Completé esta acción</button> : <button className="primary" onClick={() => act('finish')}><Check size={18} />Terminé esta tarea</button>}<button className="quiet" onClick={() => act('stop')}>Parar por hoy</button></div>
          {pending && <button className="quiet finish-whole" onClick={() => act('finish')}>Ya terminé la tarea completa</button>}

          {session.research && !researching ? (
            <div className="research-request-link"><button className="quiet" onClick={() => dispatch({ type: 'screen', screen: 'research', now: Date.now() })}>Abrir investigación guardada</button><button className="quiet" onClick={() => setResearching(true)}>Pedir otra investigación</button></div>
          ) : researching ? (
            <div style={{ marginTop: 24, padding: '20px 24px', background: '#090e1a', borderRadius: 16, border: '1px solid #335cff4d' }}>
              <label htmlFor="research-blocker" style={{ display: 'block', color: '#a6bce9', marginBottom: 12, fontWeight: 500 }}>¿Qué te frena?</label>
              <textarea
                id="research-blocker"
                maxLength={1000}
                autoFocus
                disabled={submittingBlocker}
                value={blocker}
                onChange={e => setBlocker(e.target.value)}
                placeholder="Describe qué necesitas saber o qué te impide avanzar..."
                style={{ width: '100%', minHeight: 80, padding: 12, borderRadius: 12, background: '#0a101d', border: '1px solid #ffffff14', color: '#f5f5ef', marginBottom: 16, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {session.research && <p className="meta">La nueva consulta sustituirá el acceso a la investigación anterior en tus bandejas.</p>}
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="quiet" disabled={!blocker.trim() || submittingBlocker} onClick={handleResearch}>
                  {submittingBlocker ? 'Iniciando...' : 'Pedir investigación'}
                </button>
                <button className="quiet" disabled={submittingBlocker} onClick={() => setResearching(false)}>Cancelar</button>
              </div>
              {researchError && <p role="alert">{researchError}</p>}
            </div>
          ) : (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button className="quiet" onClick={() => setResearching(true)}>¿Qué te frena? (Investigar)</button>
            </div>
          )}
        </>}
      </article>
      {!task.done && <button className="quiet back-to-trays" onClick={() => act('leave')}><ArrowLeft size={16} />Volver a las bandejas</button>}
    </main>
    <footer className="app-footer">Al volver, conservas el avance. Las otras bandejas esperan.</footer>
  </div></div>
}
