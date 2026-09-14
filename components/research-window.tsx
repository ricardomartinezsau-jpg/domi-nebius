// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'
import { useLocale } from './locale'

import { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TRAYS, type DomiSession, type SessionAction } from '@/lib/session'
import { Brand } from './brand'
import { ResearchBlock } from './research-block'

/** One screen for the saved investigation. Opening it never launches another run. */
export function ResearchWindow({ research, dispatch }: { research: NonNullable<DomiSession['research']>; dispatch: (action: SessionAction) => void }) {
  const { locale, t } = useLocale()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [research.runId])
  return <div className="domi-shell research-shell">
    <header className="domi-header"><Brand onClick={() => dispatch({ type: 'screen', screen: 'capture', now: Date.now() })} /><span className="badge">{t("Investigación ·")} {t(TRAYS.find(tray => tray.id === research.tray)?.name ?? '')}</span></header>
    <main>
      <button className="quiet research-back" onClick={() => dispatch({ type: 'screen', screen: 'trays', now: Date.now() })}><ArrowLeft size={16} />{t("Volver a las bandejas")}</button>
      <p className="eyebrow">{t("Un espacio para aclarar")}</p>
      <h1 ref={heading} tabIndex={-1}>{research.title}</h1>
      <p className="intro">{t("Revisa las fuentes a tu ritmo. Tú decides qué hacer con lo encontrado.")}</p>
      <ResearchBlock 
        key={research.runId} 
        runId={research.runId} 
        onConvertToTask={(title) => dispatch({ type: 'addTaskFromResearch', title, tray: research.tray, now: Date.now() })} 
      />
    </main>
  </div>
}
