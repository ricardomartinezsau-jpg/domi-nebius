/*
 * Esta es la interfaz provisional retirada. No está en uso.
 * No se reutilice ni se copie nada de aquí.
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuickOutput } from '@/lib/triage'

const MAX_CHARS = 4000

type Props = {
  open: boolean
  onClose: () => void
  onQuickResult: (quick: QuickOutput, rawDump: string) => void
}

/**
 * El vaciado es un modal, no una pantalla: el resultado merece la pantalla
 * completa y esto es solo la puerta de entrada.
 *
 * Dos entradas: escribir y dictar. La foto queda documentada como siguiente
 * paso — es la que más se rompe en una demo en vivo.
 */
export function BrainDump({ open, onClose, onQuickResult }: Props) {
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(true)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    fieldRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !reading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, reading, onClose])

  useEffect(() => {
    const api = typeof window !== 'undefined' && (window.SpeechRecognition ?? window.webkitSpeechRecognition)
    if (!api) setVoiceSupported(false)
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  /**
   * Se arranca de forma síncrona dentro del toque. Una comprobación de permiso
   * con await pierde la activación del usuario en móvil y abre el micrófono dos
   * veces: eso ya costó un error antes, no se repite.
   */
  const startListening = () => {
    setError(null)
    const api = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!api) {
      setVoiceSupported(false)
      return
    }
    if (!window.isSecureContext) {
      setError('El dictado necesita una conexión segura (https).')
      return
    }
    if (recognitionRef.current) return

    try {
      const recognition = new api()
      recognitionRef.current = recognition
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'es-MX'
      baseTextRef.current = text.trim()

      recognition.onstart = () => setListening(true)
      recognition.onresult = (event) => {
        let spoken = ''
        for (let i = 0; i < event.results.length; i += 1) spoken += event.results[i][0].transcript + ' '
        const base = baseTextRef.current
        setText(`${base}${base ? '\n\n' : ''}${spoken.trim()}`.slice(0, MAX_CHARS))
      }
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') setError('No diste permiso al micrófono. Puedes escribirlo.')
        else if (event.error === 'audio-capture') setError('No encontré micrófono. Puedes escribirlo.')
        else if (event.error !== 'aborted' && event.error !== 'no-speech') setError('El dictado falló. Puedes escribirlo.')
        stopListening()
      }
      recognition.onend = () => stopListening()
      recognition.start()
    } catch {
      setError('No se pudo abrir el micrófono. Puedes escribirlo.')
      stopListening()
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const rawDump = text.trim()
    if (!rawDump) {
      setError('Escribe o dicta algo antes de enviarlo.')
      return
    }
    if (listening) stopListening()
    setError(null)
    setReading(true)
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'quick', rawDump, locale: 'es' }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Algo salió mal. Intenta de nuevo.')
        return
      }
      onQuickResult(data.output as QuickOutput, rawDump)
      setText('')
    } catch {
      setError('No se pudo conectar. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setReading(false)
    }
  }

  if (!open) return null

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="dump-title">
      <form className="panel dump" onSubmit={handleSubmit}>
        <h1 className="t-voice" id="dump-title">
          Suelta todo lo que traes
        </h1>

        <textarea
          ref={fieldRef}
          className="field"
          value={text}
          maxLength={MAX_CHARS}
          rows={6}
          disabled={reading}
          onChange={(event) => setText(event.target.value)}
          placeholder="Sin ordenar, sin filtrar, como salga."
          aria-label="Vaciado mental"
        />

        <div className="dump-row">
          {voiceSupported && (
            <button
              type="button"
              className="action-second"
              onClick={listening ? stopListening : startListening}
              disabled={reading}
              aria-pressed={listening}
            >
              {listening ? 'Detener dictado' : 'Dictar'}
            </button>
          )}
          <span className="t-meta">
            {text.length} / {MAX_CHARS}
          </span>
        </div>

        {listening && (
          <p className="note" role="status">
            Te estoy escuchando. Habla como se te ocurra.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {reading ? (
          <div className="sweep" role="status" aria-live="polite">
            Domi está leyendo
          </div>
        ) : (
          <button type="submit" className="action" disabled={!text.trim()}>
            Ordenar
          </button>
        )}

        {!reading && (
          <button type="button" className="link-quiet" onClick={onClose}>
            Ahora no
          </button>
        )}
      </form>
    </div>
  )
}
