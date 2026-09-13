'use client'

import { useResearch } from './use-research'

export function ResearchBadge({ runId, onOpen }: { runId: string; onOpen: () => void }) {
  const { view, error } = useResearch(runId)
  const label = error ? 'Consultar investigación' : view?.status === 'done' ? 'Listo para revisión'
    : view?.status === 'failed' ? 'Investigación con un error' : view ? 'Investigando fuentes…' : 'Consultando investigación…'
  // Deliberately no live announcement, modal or navigation when the result arrives.
  return <button className="quiet research-tray-badge" onClick={onOpen}>{label}</button>
}
