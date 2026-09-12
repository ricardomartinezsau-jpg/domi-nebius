'use client'

import { useEffect, useState } from 'react'
import type { ResearchView } from '@/lib/research'

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
      } catch (err) {}
      timer = setTimeout(poll, 2000)
    }
    poll()
    return () => clearTimeout(timer)
  }, [runId])

  if (!view) return <div className="meta">Buscando el estado de la investigación...</div>

  return (
    <div className="research-block" style={{ marginTop: 24, padding: '20px 24px', background: '#090e1a', borderRadius: 16, border: '1px solid #335cff4d' }}>
      <h3 style={{ marginTop: 0, color: '#a6bce9', fontSize: 16 }}>Investigación {view.status === 'running' || view.status === 'queued' ? 'en progreso...' : view.status === 'failed' ? 'fallida' : 'completada'}</h3>
      
      {view.questions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {view.questions.map((q, i) => (
            <p key={i} style={{ fontSize: 14, color: '#aebacb', margin: '4px 0' }}>• {q.question}</p>
          ))}
        </div>
      )}

      {view.status === 'done' && view.guide && (
        <div className="research-guide">
          {view.guide.steps.length > 0 && (
            <ul style={{ paddingLeft: 20, color: '#f5f5ef' }}>
              {view.guide.steps.map((step, i) => (
                <li key={i} style={{ marginBottom: 12 }}>
                  <strong>{step.title}</strong><br/>
                  <span style={{ color: '#aebacb', fontSize: 14 }}>{step.detail}</span>
                  {step.sourceUrls.length > 0 && (
                    <div style={{ fontSize: 12, color: '#335cff', marginTop: 4 }}>
                      Fuentes: {step.sourceUrls.map((url, j) => <a key={j} href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', marginRight: 8 }}>[{j + 1}]</a>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view.guide.unconfirmed.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, background: '#2447c633', borderRadius: 8 }}>
              <strong style={{ color: '#b0c4ff' }}>Sin confirmar:</strong>
              <ul style={{ paddingLeft: 20, margin: '8px 0 0', color: '#aebacb', fontSize: 14 }}>
                {view.guide.unconfirmed.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {view.error && <p style={{ color: '#d97745' }}>{view.error}</p>}
    </div>
  )
}
