'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { activeRun, emptySession, restoreSession, sessionReducer, STORAGE_KEY, type DomiSession, type SessionAction } from '@/lib/session'

export function useSession() {
  const [session, setSession] = useState<DomiSession>(emptySession)
  const current = useRef(session)
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const canPersist = useRef(false)
  const persist = useCallback((next: DomiSession) => {
    if (!canPersist.current) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setStorageError(null) }
    catch { setStorageError('El navegador no pudo guardar el avance. Mantén esta pestaña abierta.') }
  }, [])
  const dispatch = useCallback((action: SessionAction) => {
    const next = sessionReducer(current.current, action)
    if (next === current.current) return
    current.current = next
    setSession(next)
    persist(next)
  }, [persist])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const restored = stored ? restoreSession(stored) : null
      if (stored && !restored) {
        setStorageError('Hay una sesión guardada que no se pudo leer. No se ha sobrescrito; esta sesión será temporal.')
      } else {
        canPersist.current = true
        if (restored) { current.current = restored; setSession(restored); persist(restored) }
      }
    } catch { setStorageError('El almacenamiento está bloqueado. Puedes usar DOMI sin cerrar esta pestaña.') }
    setReady(true)
    // Checkpoint, not a per-second counter: browser throttling cannot distort elapsed time.
    const interval = window.setInterval(() => {
      if (activeRun(current.current)?.activeSince != null) dispatch({ type: 'checkpoint', now: Date.now() })
    }, 5000)
    const leaving = () => {
      const next = sessionReducer(current.current, { type: 'pause', now: Date.now() })
      current.current = next
      persist(next)
    }
    window.addEventListener('pagehide', leaving)
    const returning = (event: PageTransitionEvent) => { if (event.persisted) setSession(current.current) }
    window.addEventListener('pageshow', returning)
    return () => { clearInterval(interval); window.removeEventListener('pagehide', leaving); window.removeEventListener('pageshow', returning) }
  }, [dispatch, persist])
  return { session, dispatch, ready, storageError }
}
