import type { Editor } from '@tiptap/react'
import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { isNative, QirtasNative } from '../lib/platform'
import { Modal } from '../ui/Modal'
import { closeAi } from './aiBus'
import { insertMarkdown } from './AiPanel'
import { AiError, streamAi, VOICE_TASK } from './client'

interface Recognizer {
  start(): void
  stop(): void
  abort(): void
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function speechLang(lang: 'ar' | 'en') {
  const nav = navigator.language || ''
  if (lang === 'ar') return nav.startsWith('ar') ? nav : 'ar-SA'
  return nav.startsWith('en') ? nav : 'en-US'
}

export function VoicePanel({ editor, at }: { editor: Editor; at: number }) {
  const lang = useStore((s) => s.settings.lang)
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognizer | null>(null)
  const finalRef = useRef('')

  useEffect(() => {
    let cancelled = false
    const native = isNative()
    if (native) {
      // Android: the app's native recognizer streams partial results back
      const nativeSpeech = QirtasNative as unknown as {
        startSpeech(o: { lang: string }): Promise<void>
        stopSpeech(): Promise<{ text: string }>
        addListener(ev: string, fn: (d: { text: string; final: boolean }) => void): Promise<{ remove(): void }>
      }
      let handle: { remove(): void } | null = null
      void nativeSpeech
        .addListener('speech', (d) => {
          if (d.final) {
            finalRef.current = (finalRef.current + ' ' + d.text).trim()
            setFinalText(finalRef.current)
            setInterim('')
          } else setInterim(d.text)
        })
        .then((h) => (handle = h))
      nativeSpeech
        .startSpeech({ lang: speechLang(lang) })
        .then(() => !cancelled && setListening(true))
        .catch(() => setError(t('voiceUnsupported')))
      rec.current = {
        stop: () => void nativeSpeech.stopSpeech().finally(() => setListening(false)),
        abort: () => void nativeSpeech.stopSpeech(),
      } as Recognizer
      return () => {
        cancelled = true
        handle?.remove()
        void nativeSpeech.stopSpeech().catch(() => {})
      }
    }
    const W = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) {
      setError(t('voiceUnsupported'))
      return
    }
    const r = new Ctor()
    r.lang = speechLang(lang)
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalRef.current = (finalRef.current + ' ' + res[0].transcript).trim()
        else interimText += res[0].transcript
      }
      setFinalText(finalRef.current)
      setInterim(interimText)
    }
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(t('voiceUnsupported'))
    }
    r.onend = () => setListening(false)
    try {
      r.start()
      setListening(true)
    } catch {
      setError(t('voiceUnsupported'))
    }
    rec.current = r
    return () => r.abort()
  }, [lang])

  const text = (finalText + ' ' + interim).trim()

  const finish = async (organize: boolean) => {
    rec.current?.stop()
    const raw = (finalRef.current + ' ' + interim).trim()
    if (!raw) return closeAi()
    if (!organize) {
      insertMarkdown(editor, raw, at, at, false)
      return closeAi()
    }
    setBusy(true)
    try {
      const out = await streamAi(`${VOICE_TASK}\n\n<text>\n${raw}\n</text>`, () => {}, new AbortController().signal)
      insertMarkdown(editor, out, at, at, false)
      closeAi()
    } catch (e) {
      if (e instanceof AiError && e.code === 'nokey') {
        // Without the assistant, keep the words as they were spoken
        insertMarkdown(editor, raw, at, at, false)
        closeAi()
      } else setError(t('aiError', { msg: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={closeAi} title={t('voiceTitle')} width={460}>
      <div className="voice">
        <div className={'voice-orb' + (listening ? ' is-on' : '')}>{busy ? <Loader2 className="spin" size={30} /> : <Mic size={30} />}</div>
        <p className="muted">{error ?? (listening ? t('voiceListening') : busy ? t('aiThinking') : '')}</p>
        <div className="voice-text" dir="auto">
          {finalText}
          {interim && <span className="muted"> {interim}</span>}
        </div>
        <div className="voice-actions">
          <button type="button" className="btn btn-primary" disabled={!text || busy} onClick={() => void finish(true)}>
            <Square size={14} /> {t('voiceStop')}
          </button>
          <button type="button" className="btn" disabled={!text || busy} onClick={() => void finish(false)}>
            {t('voiceRaw')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
