'use client'
import { useLocale } from './locale'
import { guestFetch } from '@/lib/guest-client'

import { useCallback, useEffect, useRef } from 'react'
import type { DetailOutput, QuickOutput } from '@/lib/triage'
import { Capture } from './capture'
import { Trays } from './trays'
import { Dominio } from './dominio'
import { useSession } from './use-session'
import { ResearchWindow } from './research-window'

export function DomiApp() {
  const { locale, t } = useLocale()
  const { session, dispatch, ready, storageError } = useSession()
  const requests = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const pending = requests.current
    return () => { pending.forEach(controller => controller.abort()); pending.clear() }
  }, [])
  const requestDetail = useCallback(async (id: string, rawText: string, quick: QuickOutput) => {
    if (requests.current.has(id)) return
    const controller = new AbortController()
    requests.current.set(id, controller)
    dispatch({ type: 'detailStatus', dumpId: id, status: 'pending' })
    const timeout = setTimeout(() => controller.abort(), 135_000)
    try {
      const response = await guestFetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'detail', rawDump: rawText, locale, quick }), signal: controller.signal })
      const data = await response.json()
      if (!response.ok || !data.output || !Array.isArray(data.output.dependencyOrder) || !Array.isArray(data.output.microTasks)) throw new Error('detail failed')
      dispatch({ type: 'detail', dumpId: id, detail: data.output as DetailOutput })
    } catch { dispatch({ type: 'detailStatus', dumpId: id, status: 'failed' }) }
    finally { clearTimeout(timeout); requests.current.delete(id) }
  }, [dispatch, locale])
  const onQuick = useCallback((quick: QuickOutput, rawText: string) => {
    const id = crypto.randomUUID()
    dispatch({ type: 'quick', id, rawText, quick, now: Date.now() })
    void requestDetail(id, rawText, quick)
  }, [dispatch, requestDetail])
  const onDraft = useCallback((text: string) => dispatch({ type: 'draft', text }), [dispatch])
  const retryDetail = (id: string) => {
    const dump = session.dumps.find(item => item.id === id)
    if (dump) void requestDetail(dump.id, dump.rawText, dump.quick)
  }
  if (!ready) return <main className="domi-shell" aria-busy="true"><p className="meta" role="status">{t("Abriendo tu mesa…")}</p></main>
  return <>
    {storageError && <p className="storage-notice" role="alert">{t(storageError)}</p>}
    {session.screen === 'capture' && <Capture initialText={session.draft} onDraft={onDraft} onResult={onQuick} hasTasks={session.tasks.length > 0} onBack={() => dispatch({ type: 'screen', screen: 'trays', now: Date.now() })} />}
    {session.screen === 'trays' && <Trays session={session} dispatch={dispatch} retryDetail={retryDetail} />}
    {session.screen === 'dominio' && <Dominio session={session} dispatch={dispatch} retryDetail={retryDetail} />}
    {session.screen === 'research' && session.research && <ResearchWindow research={session.research} dispatch={dispatch} />}
  </>
}
