'use client'

import { useEffect, useState } from 'react'
import type { ResearchView } from '@/lib/research'
import { observeResearch } from '@/lib/research-observer'

export function useResearch(runId: string) {
  const [view, setView] = useState<ResearchView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setView(null)
    setError(null)
    return observeResearch(runId, setView, setError)
  }, [runId])
  return { view: view?.runId === runId ? view : null, error }
}
