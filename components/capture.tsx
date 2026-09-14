// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

'use client'
import { useLocale } from './locale'
import { guestFetch } from '@/lib/guest-client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Clock, List, MessageSquare, Mic, Square, X } from 'lucide-react'
import { quickResultSchema } from '@/lib/session'
import type { QuickOutput } from '@/lib/triage'
import { Brand } from './brand'

type Props = { initialText: string; onDraft: (text: string) => void; onResult: (quick: QuickOutput, raw: string) => void; onBack: () => void; hasTasks: boolean }

const MAX_LENGTH = 4000
const SUGGESTIONS = [
  { label: 'Una conversación pendiente...', text: 'Hay una conversación pendiente con', icon: MessageSquare },
  { label: 'Algo que me preocupa...', text: 'Tengo atorado resolver', icon: Clock },
  { label: 'Cargas acumuladas...', text: 'Siento que tengo que hacer mil cosas hoy, en especial', icon: List },
]

function composeText(pills: string[], text: string) {
  const prefix = pills.join('. ')
  const typed = text.trim()
  return (prefix && typed ? `${prefix}: ${typed}` : prefix || typed).slice(0, MAX_LENGTH)
}

function fieldCapacity(pills: string[]) {
  // Reserve both the pill separators and ": " before any free text.
  return MAX_LENGTH - (pills.length ? pills.join('. ').length + 2 : 0)
}

/** Production version of Antigravity's screen 01; no simulated speech or fake results. */
export function Capture({ initialText, onDraft, onResult, onBack, hasTasks }: Props) {
  const { locale, t } = useLocale()
  const [text, setText] = useState(initialText.slice(0, MAX_LENGTH))
  const [pills, setPills] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [modifier, setModifier] = useState('Ctrl')
  const field = useRef<HTMLTextAreaElement>(null)
  const speech = useRef<SpeechRecognitionLike | null>(null)
  const request = useRef<AbortController | null>(null)
  const sending = useRef(false)
  const textRef = useRef(text)
  const pillsRef = useRef(pills)
  textRef.current = text
  pillsRef.current = pills
  const maxTextLength = fieldCapacity(pills)
  const fullText = composeText(pills, text)

  // Pills are transient UI; the existing draft contract stores only composed text.
  useEffect(() => { onDraft(fullText) }, [fullText, onDraft])
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
    if (!window.isSecureContext) { setError(t("El dictado necesita HTTPS o localhost. Puedes escribir tu lista.")); return }
    setError('')
    setHint('')
    const base = textRef.current.trim()
    try {
      const recognition = new Recognition()
      speech.current = recognition
      recognition.lang = locale === 'en' ? 'en-US' : 'es-MX'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => setListening(true)
      recognition.onresult = (event) => {
        let sessionText = ''
        for (let i = 0; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript.trim()
          if (!chunk) continue
          
          const cleanSession = sessionText.replace(/\s+/g, '').toLowerCase()
          const cleanChunk = chunk.replace(/\s+/g, '').toLowerCase()
          
          if (cleanSession && cleanChunk.startsWith(cleanSession)) {
            sessionText = chunk
          } else {
            sessionText = sessionText ? `${sessionText} ${chunk}` : chunk
          }
        }
        const next = `${base}${base ? '\n' : ''}${sessionText}`.slice(0, fieldCapacity(pillsRef.current))
        textRef.current = next
        setText(next)
      }
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') setError(t("No se habilitó el micrófono. Puedes seguir escribiendo."))
        else if (event.error !== 'aborted' && event.error !== 'no-speech') setError(t("No se pudo continuar el dictado. Lo escrito sigue aquí."))
        stop()
      }
      recognition.onend = () => { if (speech.current === recognition) { speech.current = null; setListening(false) } }
      // Must stay synchronous inside the gesture: awaiting a permission probe breaks mobile speech.
      recognition.start()
    } catch { stop(); setError(t("No se pudo abrir el micrófono. Puedes escribir tu lista.")) }
  }

  function removePill(indexToRemove: number) {
    if (sending.current || speech.current) return
    const next = pillsRef.current.filter((_, i) => i !== indexToRemove)
    pillsRef.current = next
    setPills(next)
    setHint('')
    field.current?.focus()
  }

  function addPill(suggestion: string) {
    if (sending.current || speech.current) return
    if (!pillsRef.current.includes(suggestion)) {
      const next = [...pillsRef.current, suggestion]
      // Never discard an existing thought to make room for a suggestion.
      if (textRef.current.length > fieldCapacity(next)) {
        setHint(t("Tu texto sigue completo. Para añadir esta sugerencia, deja un poco de espacio o continúa con lo escrito."))
        field.current?.focus()
        return
      }
      pillsRef.current = next
      setPills(next)
    }
    setHint('')
    field.current?.focus()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (sending.current) return
    const raw = composeText(pillsRef.current, textRef.current).slice(0, MAX_LENGTH)
    if (!raw) { setHint(t("Puedes empezar con un solo pendiente.")); field.current?.focus(); return }
    stop()
    sending.current = true
    setBusy(true)
    setError('')
    setHint('')
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 135_000)
    try {
      const response = await guestFetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'quick', rawDump: raw, locale }), signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error('triage failed')
      const parsed = quickResultSchema.safeParse(data.output)
      if (!parsed.success) throw new Error('invalid quick output')
      onResult(parsed.data, raw)
    } catch { setError(t("No llegó una respuesta completa. Tu lista sigue aquí; puedes intentarlo otra vez.")) }
    finally { clearTimeout(timeout); sending.current = false; setBusy(false) }
  }

  return <div className="domi-shell capture-shell">
    <header className="domi-header">
      <Brand onClick={() => field.current?.focus()} />
      {hasTasks ? <button className="quiet" onClick={onBack} disabled={busy}>{t("Mis pendientes")}</button> : <span className="capture-badge">{t("La mesa libre")}</span>}
    </header>
    <main className="capture-main">
      <form onSubmit={submit} aria-labelledby="capture-title">
        <h1 id="capture-title">{t("Suelta lo que traes")}<br />{t("en la cabeza.")}</h1>
        <p className="intro">{t("Escríbelo o cuéntamelo como te salga. Sin orden, sin juzgar; luego decidimos qué merece espacio.")}</p>

        <div className="domi-prompts-bar" aria-label={t("Sugerencias rápidas")}>
          {SUGGESTIONS.map(({ label, text: suggestion, icon: Icon }) => (
            <button key={suggestion} type="button" className="domi-chip" disabled={busy || listening} aria-pressed={pills.includes(t(suggestion))} onClick={() => addPill(t(suggestion))}>
              <Icon size={12} aria-hidden="true" /> {t(label)}
            </button>
          ))}
        </div>

        <div className="capture-canvas">
          <div className="capture-input-wrap">
            <label className="capture-label" htmlFor="capture-text">{t("¿Qué tienes en la cabeza?")}</label>
            {pills.length > 0 && (
              <div className="domi-input-pills-container" aria-label={t("Sugerencias activas")}>
                {pills.map((pill, index) => (
                  <span key={pill} className="domi-input-pill">
                    <span className="domi-input-pill-text">{pill}</span>
                    <button type="button" className="domi-pill-remove-btn" disabled={busy || listening} onClick={() => removePill(index)} aria-label={`${t("Eliminar sugerencia")} ${pill}`} title={t("Eliminar sugerencia")}>
                      <X size={12} aria-hidden="true" />
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
              maxLength={maxTextLength}
              disabled={busy}
              readOnly={listening}
              placeholder={pills.length > 0 ? t("Continúa tu pensamiento aquí...") : t("¿Qué tienes en la cabeza? Deja caer tareas, compromisos o pensamientos sueltos...")}
              aria-describedby="capture-help"
              onChange={event => { const next = event.target.value.slice(0, maxTextLength); textRef.current = next; setText(next); setError(''); setHint('') }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
                if (event.key === 'Backspace' && !textRef.current && pillsRef.current.length && !listening && !busy) { event.preventDefault(); removePill(pillsRef.current.length - 1) }
              }}
            />
          </div>

          {listening && (
            <div className="voice-panel" role="status">
              <span className="voice-wave" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} style={{ animationDelay: `${i * -0.15}s` }} />)}
              </span>
              <div className="voice-text">
                <strong>{t("Escuchando con calma…")}</strong>
                <small>{t("Habla a tu propio ritmo. Sin prisas.")}</small>
              </div>
              <button type="button" className="quiet" onClick={stop}>{t("Listo")}</button>
            </div>
          )}

          <div className="capture-footer">
            <span id="capture-help" className="capture-reassurance" role="status">
              {fullText.length > 80 ? <><Check size={15} aria-hidden="true" /><span><strong>{fullText.split(/\s+/).length} {t("palabras")}</strong> {t("· La mesa sostiene todo lo que pongas")}</span></> : fullText.length ? t("Sigue escribiendo sin ordenar. Domi te ayuda después.") : <><Clock size={15} aria-hidden="true" /><span>{t("Tómate tu tiempo. No hay límite.")}</span></>}
            </span>
            <span className="shortcut"><kbd>{modifier}</kbd> + <kbd>Enter</kbd></span>
          </div>
        </div>

        <div className="capture-actions">
          <button className="secondary" type="button" disabled={busy || !supported} onClick={speak} aria-pressed={listening}>
            {listening ? <Square size={18} /> : <Mic size={20} />}
            {listening ? t("Terminar dictado") : t("Hablar")}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("Aclarando la mesa…") : <>{t("Encontrar una cosa")} <ArrowRight size={18} /></>}
          </button>
        </div>

        {!supported && <p className="meta">{t("El dictado no está disponible en este navegador. Puedes escribir.")}</p>}
        {busy && <p className="loading-line" role="status">{t("Domi está repartiendo tus pendientes en las cuatro bandejas…")}</p>}
        {hint && <p className="meta" role="status">{hint}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
    <footer className="app-footer capture-manifesto"><span className="capture-footer-dot" aria-hidden="true" /><span>{t("Primero alivio, después capacidad de actuar. Nunca examen.")}</span></footer>
  </div>
}
