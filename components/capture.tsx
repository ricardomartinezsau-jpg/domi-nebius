'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Mic, Square } from 'lucide-react'
import { quickResultSchema } from '@/lib/session'
import type { QuickOutput } from '@/lib/triage'
import { Brand } from './brand'

type Props = { initialText: string; onDraft: (text: string) => void; onResult: (quick: QuickOutput, raw: string) => void; onBack: () => void; hasTasks: boolean }

/** Production version of Antigravity's screen 01; no simulated speech or fake results. */
export function Capture({ initialText, onDraft, onResult, onBack, hasTasks }: Props) {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [modifier, setModifier] = useState('Ctrl')
  const field = useRef<HTMLTextAreaElement>(null)
  const speech = useRef<SpeechRecognitionLike | null>(null)
  const request = useRef<AbortController | null>(null)
  const sending = useRef(false)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => { onDraft(text) }, [text, onDraft])
  useEffect(() => {
    setSupported(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition))
    setModifier(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl')
    return () => {
      request.current?.abort()
      if (speech.current) { speech.current.onend = null; speech.current.onerror = null; speech.current.onresult = null; speech.current.stop() }
    }
  }, [])

  const stop = useCallback(() => {
    const recognition = speech.current
    speech.current = null
    if (recognition) { recognition.onresult = null; recognition.onend = null; recognition.onerror = null; recognition.stop() }
    setListening(false)
  }, [])

  function speak() {
    if (speech.current) { stop(); return }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) { setSupported(false); return }
    if (!window.isSecureContext) { setError('El dictado necesita HTTPS o localhost. Puedes escribir tu lista.'); return }
    setError('')
    const base = textRef.current.trim()
    try {
      const recognition = new Recognition()
      speech.current = recognition
      recognition.lang = 'es-MX'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => setListening(true)
      recognition.onresult = (event) => {
        const phrases: string[] = []
        for (let i = 0; i < event.results.length; i++) phrases.push(event.results[i][0].transcript)
        const next = `${base}${base ? '\n' : ''}${phrases.join(' ').trim()}`.slice(0, 4000)
        textRef.current = next
        setText(next)
      }
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') setError('No se habilitó el micrófono. Puedes seguir escribiendo.')
        else if (event.error !== 'aborted' && event.error !== 'no-speech') setError('No se pudo continuar el dictado. Lo escrito sigue aquí.')
        stop()
      }
      recognition.onend = () => { if (speech.current === recognition) { speech.current = null; setListening(false) } }
      // Must stay synchronous inside the gesture: awaiting a permission probe breaks mobile speech.
      recognition.start()
    } catch { stop(); setError('No se pudo abrir el micrófono. Puedes escribir tu lista.') }
  }

  const [pills, setPills] = useState<string[]>([])

  const SUGGESTIONS = [
    'Hay una conversación pendiente con…',
    'Tengo que enviar…',
    'Pagar el servicio de…',
    'Pendiente de la casa: ',
  ]

  const removePill = (indexToRemove: number) => {
    setPills(prev => prev.filter((_, i) => i !== indexToRemove))
  }

  const addPill = (suggestion: string) => {
    if (!pills.includes(suggestion)) {
      setPills(prev => [...prev, suggestion])
    }
  }

  const getFullText = () => {
    const parts = [...pills, textRef.current.trim()].filter(Boolean)
    return parts.join('\n')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (sending.current) return
    const raw = getFullText().trim()
    if (!raw) { setError('Puedes empezar con un solo pendiente.'); field.current?.focus(); return }
    stop()
    sending.current = true
    setBusy(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 135_000)
    try {
      const response = await fetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'quick', rawDump: raw, locale: 'es' }), signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error('triage failed')
      const parsed = quickResultSchema.safeParse(data.output)
      if (!parsed.success) throw new Error('invalid quick output')
      onResult(parsed.data, raw)
    } catch { setError('No llegó una respuesta completa. Tu lista sigue aquí; puedes intentarlo otra vez.') }
    finally { clearTimeout(timeout); sending.current = false; setBusy(false) }
  }

  return <div className="domi-shell capture-shell">
    <header className="domi-header">
      <Brand />
      {hasTasks && <button className="quiet" onClick={onBack} disabled={busy}>Mis bandejas</button>}
    </header>
    <main className="capture-main">
      <form onSubmit={submit} aria-labelledby="capture-title">
        <h1 id="capture-title">Dime tus pendientes.</h1>
        <p className="intro">Tal como los tienes, sin ordenar nada.<br />Puedes escribirlos o contármelos.</p>
        
        {/* Chips de sugerencia rápida para detonar ideas */}
        <div className="domi-prompts-bar" aria-label="Sugerencias rápidas">
          {SUGGESTIONS.map((sug, i) => (
            <button
              key={i}
              type="button"
              className="domi-chip"
              disabled={busy}
              onClick={() => addPill(sug)}
            >
              <span>+</span> {sug}
            </button>
          ))}
        </div>

        <div className="capture-canvas">
          <div className="field-label-group">
            <label className="field-label" htmlFor="capture-text">Tu lista, como salga</label>
          </div>

          {/* Pastillas añadidas al lienzo con botón 'x' para eliminar en 1 clic */}
          {pills.length > 0 && (
            <div className="domi-input-pills-container" aria-label="Sugerencias activas">
              {pills.map((pill, index) => (
                <span key={index} className="domi-input-pill">
                  <span className="domi-input-pill-text">{pill}</span>
                  <button
                    type="button"
                    className="domi-pill-remove-btn"
                    onClick={() => removePill(index)}
                    aria-label={`Eliminar sugerencia ${pill}`}
                    title="Eliminar sugerencia"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            id="capture-text"
            ref={field}
            value={text}
            rows={5}
            maxLength={4000}
            disabled={busy}
            readOnly={listening}
            placeholder={pills.length > 0 ? "Escribe aquí los detalles del pendiente..." : "Tengo que responder a Ana, pagar la luz, comprar café…"}
            aria-describedby="capture-help"
            onChange={event => { textRef.current = event.target.value; setText(event.target.value); setError('') }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}
          />

          {listening && (
            <div className="voice-panel" role="status">
              <span className="voice-wave" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} style={{ animationDelay: `${i * -0.15}s` }} />)}
              </span>
              <div className="voice-text">
                <strong>Escuchando con calma…</strong>
                <small>Habla a tu propio ritmo. Sin prisas.</small>
              </div>
              <button type="button" className="quiet" onClick={stop}>Listo</button>
            </div>
          )}

          <div className="capture-footer">
            <span id="capture-help">
              {text.length >= 3800 ? `${4000 - text.length} caracteres disponibles` : 'No necesitas una lista perfecta.'}
            </span>
            <span className="shortcut"><kbd>{modifier}</kbd> + <kbd>Enter</kbd></span>
          </div>
        </div>

        <div className="capture-actions">
          <button className="secondary" type="button" disabled={busy || !supported} onClick={speak} aria-pressed={listening}>
            {listening ? <Square size={18} /> : <Mic size={20} />}
            {listening ? 'Terminar dictado' : 'Hablar'}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Aclarando la mesa…' : <>Encontrar una cosa <ArrowRight size={18} /></>}
          </button>
        </div>

        {!supported && <p className="meta">El dictado no está disponible en este navegador. Puedes escribir.</p>}
        {busy && <p className="loading-line" role="status">Domi está repartiendo tus pendientes en las cuatro bandejas…</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
    <footer className="app-footer">Tu avance se conserva en este navegador.</footer>
  </div>
}
