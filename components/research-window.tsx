'use client'

import { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TRAYS, type DomiSession, type SessionAction } from '@/lib/session'
import { Brand } from './brand'
import { ResearchBlock } from './research-block'

/** One screen for the saved investigation. Opening it never launches another run. */
export function ResearchWindow({ research, dispatch }: { research: NonNullable<DomiSession['research']>; dispatch: (action: SessionAction) => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [research.runId])
  return <div className="domi-shell research-shell">
    <header className="domi-header"><Brand /><span className="badge">Investigación · {TRAYS.find(tray => tray.id === research.tray)?.name}</span></header>
    <main>
      <button className="quiet research-back" onClick={() => dispatch({ type: 'screen', screen: 'trays', now: Date.now() })}><ArrowLeft size={16} />Volver a las bandejas</button>
      <p className="eyebrow">Un espacio para aclarar</p>
      <h1 ref={heading} tabIndex={-1}>{research.title}</h1>
      <p className="intro">Revisa las fuentes a tu ritmo. Tú decides qué hacer con lo encontrado.</p>
      <ResearchBlock 
        key={research.runId} 
        runId={research.runId} 
        onConvertToTask={(title) => dispatch({ type: 'addTaskFromResearch', title, tray: research.tray, now: Date.now() })} 
      />
    </main>
  </div>
}
