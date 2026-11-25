import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Copy, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../data/store'
import { t } from '../../lib/i18n'
import { copyText } from '../../lib/platform'
import { requestQuran } from '../../quran/bus'
import { cleanRef, loadQuran, quotation, quranIfLoaded, refLabel, versesOf } from '../../quran/quran'

/** A quotation from the Quran, in the Mushaf's script, with its reference under it. */
export function QuranVerseView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const lang = useStore((s) => s.settings.lang)
  const numerals = useStore((s) => s.settings.numerals)
  const ref = cleanRef(node.attrs.surah, node.attrs.from, node.attrs.to)
  const stored = String(node.attrs.text ?? '')
  // A block without its text (pasted from elsewhere) shows the verses from the Quran's data
  const [data, setData] = useState(quranIfLoaded)
  useEffect(() => {
    if (!stored && ref && !data) loadQuran().then(setData, () => {})
  }, [stored, !!ref, data])
  const verses = stored ? stored.split('\n') : ref && data ? versesOf(data, ref) : []
  const label = ref ? refLabel(ref, lang, numerals) : ''
  const text = ref ? quotation(verses, ref.from) : ''

  const copy = async () => {
    if (await copyText(`${text} ${label}`)) useStore.getState().toast(t('qCopied'))
  }
  const change = () =>
    requestQuran((r, list) => {
      updateAttributes({ surah: r.surah, from: r.from, to: r.to, text: list.join('\n') })
    }, ref)

  return (
    <NodeViewWrapper className={'quran-verse' + (selected ? ' is-selected' : '')} data-drag-handle="">
      <div className="qv-text" lang="ar" dir="rtl">
        {verses.length ? text : '…'}
      </div>
      <div className="qv-foot">
        <span className="qv-ref">{label}</span>
        <span className="qv-tools">
          <button type="button" className="icon-btn" onClick={() => void copy()} title={t('qCopy')} aria-label={t('qCopy')}>
            <Copy size={15} />
          </button>
          {editor.isEditable && (
            <button type="button" className="icon-btn" onClick={change} title={t('qChangeTitle')} aria-label={t('qChangeTitle')}>
              <Pencil size={15} />
            </button>
          )}
        </span>
      </div>
    </NodeViewWrapper>
  )
}
