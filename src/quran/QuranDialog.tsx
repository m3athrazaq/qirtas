// Choose verses to quote: type a reference ("البقرة ٢٥٥", "2:255-257"), a surah's name, or words
// from the verse; pick a verse (shift-click, shift-arrows or the "to" box for several); insert.
import { Search } from 'lucide-react'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../data/store'
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'
import { closeQuran, useQuranPick, type QuranPick } from './bus'
import { ayahMark, cleanRef, loadQuran, parseQuery, quranIfLoaded, refLabel, refQuery, searchVerses, surahName, versesOf, type VerseRef } from './quran'
import { SURAHS } from './surahs'

type Row = { kind: 'surah'; surah: number } | { kind: 'verse'; surah: number; ayah: number }

export function QuranDialog() {
  const onPick = useQuranPick((s) => s.onPick)
  const initial = useQuranPick((s) => s.initial)
  if (!onPick) return null
  return <QuranInner initial={initial} onPick={onPick} />
}

const toNumber = (s: string) => Number(s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).trim())

/** A verse number box: typing is free, a number that fits is taken as it is typed. */
function VerseField({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const numerals = useStore((s) => s.settings.numerals)
  const [text, setText] = useState<string | null>(null)
  return (
    <label className="q-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={text ?? num(value, numerals)}
        onChange={(e) => {
          setText(e.target.value)
          const n = toNumber(e.target.value)
          if (Number.isInteger(n) && n >= 1 && n <= max) onChange(n)
        }}
        onBlur={() => setText(null)}
        onFocus={(e) => e.target.select()}
      />
    </label>
  )
}

function QuranInner({ initial, onPick }: { initial: VerseRef | null; onPick: QuranPick }) {
  const lang = useStore((s) => s.settings.lang)
  const numerals = useStore((s) => s.settings.numerals)
  const n = (x: number) => num(x, numerals)
  const [q, setQ] = useState(() => (initial ? refQuery(initial, lang, numerals) : ''))
  const [data, setData] = useState(quranIfLoaded)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!data) loadQuran().then(setData, () => setFailed(true))
  }, [data])

  const query = useDeferredValue(q)
  const parsed = useMemo(() => parseQuery(query), [query])
  const [sel, setSel] = useState<VerseRef | null>(initial)
  const anchor = useRef(initial?.from ?? 0)
  const [active, setActive] = useState(-1)
  const refKey = parsed.ref ? `${parsed.ref.surah}:${parsed.ref.from}-${parsed.ref.to}` : ''
  // A typed reference chooses its verses; typing anything else starts a new choice
  useEffect(() => {
    setActive(-1)
    setSel(parsed.ref)
    if (parsed.ref) anchor.current = parsed.ref.from
  }, [parsed])

  const { rows, more } = useMemo(() => {
    const ref = parsed.ref
    if (ref) return { rows: Array.from({ length: SURAHS[ref.surah - 1][2] }, (_, i): Row => ({ kind: 'verse', surah: ref.surah, ayah: i + 1 })), more: 0 }
    if (!query.trim()) return { rows: SURAHS.map((_, i): Row => ({ kind: 'surah', surah: i + 1 })), more: 0 }
    const out: Row[] = parsed.surahs.slice(0, 5).map((s) => ({ kind: 'surah', surah: s }))
    let extra = 0
    if (data && parsed.words.length) {
      const found = searchVerses(data, parsed.words)
      found.hits.forEach((h) => out.push({ kind: 'verse', ...h }))
      extra = found.total - found.hits.length
    }
    return { rows: out, more: extra }
  }, [parsed, query, data])

  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // The row moved to with the keys, or (after a reference was typed) the first verse it names
    const sel = active >= 0 ? `[data-i="${active}"]` : parsed.ref ? `[data-ayah="${parsed.ref.from}"]` : null
    if (sel) list.current?.querySelector(sel)?.scrollIntoView({ block: active >= 0 ? 'nearest' : 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refKey, !!data])

  const inSel = (surah: number, ayah: number) => !!sel && sel.surah === surah && ayah >= sel.from && ayah <= sel.to
  const pickVerse = (surah: number, ayah: number, extend: boolean) => {
    if (extend && sel && sel.surah === surah) {
      const a = anchor.current || sel.from
      setSel({ surah, from: Math.min(a, ayah), to: Math.max(a, ayah) })
    } else {
      anchor.current = ayah
      setSel({ surah, from: ayah, to: ayah })
    }
  }
  const openSurah = (s: number) => setQ(`${surahName(s, lang)} ${n(1)}`)
  const insert = (r: VerseRef | null = sel) => {
    const ref = r && cleanRef(r.surah, r.from, r.to)
    if (!ref || !data) return
    onPick(ref, versesOf(data, ref))
    closeQuran()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      const down = e.key === 'ArrowDown'
      let at = active
      if (at < 0 && sel) at = rows.findIndex((r) => r.kind === 'verse' && r.surah === sel.surah && r.ayah === (down ? sel.to : sel.from))
      const next = at < 0 ? (down ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + (down ? 1 : -1)))
      setActive(next)
      const r = rows[next]
      if (r.kind === 'verse') pickVerse(r.surah, r.ayah, e.shiftKey)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = active >= 0 ? rows[active] : null
      const first = rows[0]
      if (r?.kind === 'surah') openSurah(r.surah)
      else if (sel) insert()
      // Nothing chosen yet: a surah's name opens it, words choose the first verse found
      else if (first?.kind === 'surah') openSurah(first.surah)
      else if (first?.kind === 'verse') {
        setActive(0)
        pickVerse(first.surah, first.ayah, false)
      }
    }
  }

  const count = sel ? SURAHS[sel.surah - 1][2] : 0
  const waiting = !data && !failed && (!!parsed.ref || parsed.words.length > 0)

  return (
    <Modal open onClose={closeQuran} title={initial ? t('qChangeTitle') : t('qTitle')} width={660} className="quran-modal" top>
      <div className="search-box">
        <Search size={17} className="muted" />
        <input autoFocus dir="auto" value={q} placeholder={t('qPlaceholder')} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      </div>
      {!q.trim() && <p className="q-hint muted">{t('qHint')}</p>}
      <div className="q-list" ref={list} role="listbox" aria-multiselectable="true">
        {failed && <p className="q-empty">{t('qLoadFailed')}</p>}
        {waiting && <p className="q-empty muted">{t('qLoading')}</p>}
        {rows.map((r, i) =>
          r.kind === 'surah' ? (
            <button key={'s' + r.surah} data-i={i} type="button" className={'q-row q-surah' + (i === active ? ' is-active' : '')} onClick={() => openSurah(r.surah)}>
              <span className="q-num">{n(r.surah)}</span>
              <span className="q-surah-name" lang="ar">
                {surahName(r.surah, 'ar')}
              </span>
              <span className="q-surah-en muted">{surahName(r.surah, 'en')}</span>
              <span className="q-surah-count muted">{t('qVersesN', { n: n(SURAHS[r.surah - 1][2]) })}</span>
            </button>
          ) : (
            data && (
              <button
                key={`v${r.surah}:${r.ayah}`}
                data-i={i}
                data-ayah={r.ayah}
                type="button"
                role="option"
                aria-selected={inSel(r.surah, r.ayah)}
                className={'q-row q-verse' + (inSel(r.surah, r.ayah) ? ' is-on' : '') + (i === active ? ' is-active' : '')}
                onClick={(e) => pickVerse(r.surah, r.ayah, e.shiftKey)}
                onDoubleClick={() => insert(inSel(r.surah, r.ayah) ? sel : { surah: r.surah, from: r.ayah, to: r.ayah })}
              >
                <span className="q-verse-text" lang="ar" dir="rtl">
                  {data[r.surah - 1][r.ayah - 1]}
                  {' '}
                  {ayahMark(r.ayah)}
                </span>
                {!parsed.ref && <span className="q-verse-ref">{refLabel({ surah: r.surah, from: r.ayah, to: r.ayah }, lang, numerals)}</span>}
              </button>
            )
          ),
        )}
        {more > 0 && <p className="q-more muted">{t('qMore', { n: n(more) })}</p>}
        {!!query.trim() && !parsed.ref && !!data && !rows.length && <p className="q-empty muted">{t('qNothing')}</p>}
      </div>
      <div className="q-foot">
        {sel ? (
          <div className="q-range">
            <b>{t('qSurah', { name: surahName(sel.surah, lang) })}</b>
            <VerseField
              label={t('qFrom')}
              value={sel.from}
              max={count}
              onChange={(v) => {
                anchor.current = v
                setSel({ ...sel, from: v, to: Math.max(v, sel.to) })
              }}
            />
            <VerseField label={t('qTo')} value={sel.to} max={count} onChange={(v) => setSel({ ...sel, from: Math.min(sel.from, v), to: v })} />
          </div>
        ) : (
          <span className="muted small">{t('qPickHint')}</span>
        )}
        <button type="button" className="btn btn-primary" disabled={!sel || !data} onClick={() => insert()}>
          {initial ? t('qUpdate') : t('qInsert')}
        </button>
      </div>
      <p className="q-source muted">
        {t('qSource')}{' '}
        <span className="q-links" dir="ltr">
          <a href="https://quranenc.com" target="_blank" rel="noopener noreferrer">
            QuranEnc
          </a>
          {' · '}
          <a href="https://github.com/risan/quran-json" target="_blank" rel="noopener noreferrer">
            quran-json
          </a>
          {' · '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY 4.0
          </a>
        </span>
      </p>
    </Modal>
  )
}
