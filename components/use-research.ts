// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'

import { useEffect, useState } from 'react'
import type { ResearchView } from '@/lib/research'
import { observeResearch } from '@/lib/research-observer'

export function useResearch(runId: string, refresh = 0) {
  const [view, setView] = useState<ResearchView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setView(null)
    setError(null)
    return observeResearch(runId, setView, setError)
  }, [runId, refresh])
  return { view: view?.runId === runId ? view : null, error }
}
