import type { ResearchView } from './research'

/** One observer owns its request, timer and wake listeners. GET never restarts work. */
export function observeResearch(runId: string, onView: (view: ResearchView) => void, onError: (message: string | null) => void) {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let requestTimeout: ReturnType<typeof setTimeout> | undefined
  let inaccessible = false
  let retryAt = 0

  const cancel = () => {
    clearTimeout(timer)
    clearTimeout(requestTimeout)
    request?.abort()
    request = undefined
  }
  const poll = async () => {
    if (disposed || inaccessible || document.visibilityState === 'hidden' || request) return
    if (Date.now() < retryAt) { clearTimeout(timer); timer = setTimeout(poll, retryAt - Date.now()); return }
    clearTimeout(timer)
    const controller = new AbortController()
    request = controller
    const timeout = setTimeout(() => controller.abort(), 15_000)
    requestTimeout = timeout
    let terminal = false
    try {
      const response = await fetch(`/api/research?runId=${encodeURIComponent(runId)}`, { signal: controller.signal, cache: 'no-store' })
      if (response.status === 404) inaccessible = true
      if (response.status === 429) retryAt = Date.now() + Math.max(1, Number(response.headers?.get('retry-after')) || 60) * 1000
      if (!response.ok) throw new Error(response.status === 404 ? 'Esta investigación no está disponible con la sesión de este navegador.' : response.status === 429 ? 'Se alcanzó el límite de consultas. Esperaremos antes de volver a leer.' : 'No pudimos actualizar la investigación. Volveremos a consultar.')
      const view: ResearchView = await response.json()
      if (view.runId !== runId || !['queued', 'running', 'done', 'failed'].includes(view.status)) throw new Error('La respuesta no corresponde a esta investigación.')
      if (disposed || controller.signal.aborted || request !== controller) return
      terminal = view.status === 'done' || view.status === 'failed'
      onView(view)
      onError(null)
    } catch (error) {
      if (!disposed && request === controller) onError(error instanceof Error && error.name !== 'AbortError' ? error.message : 'La conexión está tardando. Volveremos a consultar.')
    } finally {
      clearTimeout(timeout)
      // A late response cannot resurrect an observer or overwrite a newer request.
      if (!disposed && request === controller) {
        request = undefined
        if (!terminal && !inaccessible && document.visibilityState === 'visible') timer = setTimeout(poll, Math.max(2500, retryAt - Date.now()))
      }
    }
  }
  const visibility = () => {
    if (document.visibilityState === 'hidden') cancel()
    else void poll()
  }
  const leaving = () => cancel()
  const returning = () => { void poll() }
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', leaving)
  window.addEventListener('pageshow', returning)
  void poll()
  return () => {
    disposed = true
    cancel()
    document?.removeEventListener('visibilitychange', visibility)
    window?.removeEventListener('pagehide', leaving)
    window?.removeEventListener('pageshow', returning)
  }
}
