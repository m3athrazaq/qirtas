// In-app confirm / text prompts (native dialogs are blocked or look out of place on phones).
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { t } from '../lib/i18n'
import { Modal } from './Modal'

interface DialogReq {
  kind: 'confirm' | 'text'
  message: string
  confirmLabel?: string
  danger?: boolean
  placeholder?: string
  initial?: string
  requireText?: string
  resolve: (v: boolean | string | null) => void
}

const useDialog = create<{ req: DialogReq | null }>(() => ({ req: null }))

export function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ req: { kind: 'confirm', message, ...opts, resolve: (v) => resolve(v === true) } }))
}

export function askText(message: string, opts: { placeholder?: string; initial?: string; confirmLabel?: string; requireText?: string; danger?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => useDialog.setState({ req: { kind: 'text', message, ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) } }))
}

export function DialogHost() {
  const req = useDialog((s) => s.req)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setValue(req?.initial ?? '')
    if (req?.kind === 'text') setTimeout(() => input.current?.focus(), 30)
  }, [req])
  if (!req) return null
  const done = (v: boolean | string | null) => {
    useDialog.setState({ req: null })
    req.resolve(v)
  }
  const blocked = req.kind === 'text' && (req.requireText ? value.trim() !== req.requireText : !value.trim())
  return (
    <Modal open onClose={() => done(req.kind === 'confirm' ? false : null)} width={420}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return
          done(req.kind === 'confirm' ? true : value.trim())
        }}
      >
        <p className="dialog-msg">{req.message}</p>
        {req.kind === 'text' && <input ref={input} id="dialog-input" className="input" dir="auto" value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => done(req.kind === 'confirm' ? false : null)}>
            {t('cancel')}
          </button>
          <button type="submit" className={'btn ' + (req.danger ? 'btn-danger' : 'btn-primary')} disabled={blocked}>
            {req.confirmLabel ?? t('confirm')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
