import { MarkdownManager } from '@tiptap/markdown'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getDoc, pageDocId } from '../data/docs'
import { valueText, viewRows } from '../data/dbops'
import { useStore } from '../data/store'
import type { PageMeta } from '../data/types'
import { schemaExtensions } from '../editor/ext'
import { markdownHooks } from '../editor/ext/markdownHooks'
import { compareOrder } from './ids'
import { formatDual } from './hijri'
import { t } from './i18n'
import { isNative, saveFile } from './platform'

let manager: MarkdownManager | null = null
function md(): MarkdownManager {
  if (!manager) manager = new MarkdownManager({ extensions: schemaExtensions() })
  return manager
}

export function installMarkdownHooks() {
  const pages = () => useStore.getState().pages
  markdownHooks.pageTitle = (id) => pages()[id]?.title || t('untitled')
  markdownHooks.pageLink = (id) => {
    const p = pages()[id]
    return `[${p?.icon ? p.icon + ' ' : ''}${p?.title || t('untitled')}](#/p/${id})`
  }
  markdownHooks.date = (iso) => {
    if (!iso) return ''
    const s = useStore.getState().settings
    return formatDual(iso, s.calendar, { lang: s.lang, numerals: s.numerals })
  }
  markdownHooks.database = (id) => databaseToMarkdown(id)
}

function rowsOf(dbId: string): PageMeta[] {
  const pages = useStore.getState().pages
  return Object.values(pages)
    .filter((p) => p.parentId === dbId && p.type === 'row' && !p.deletedAt)
    .sort(compareOrder)
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function databaseToMarkdown(dbId: string): string {
  const db = useStore.getState().pages[dbId]
  if (!db) return ''
  const schema = db.schema ?? []
  const view = db.views?.[0]
  const rows = view ? viewRows(rowsOf(dbId), schema, view) : rowsOf(dbId)
  const props = schema.filter((p) => !view?.hidden.includes(p.id))
  const head = `| ${props.map((p) => cell(p.name)).join(' | ')} |`
  const sep = `| ${props.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${props.map((p) => cell(valueText(r, p))).join(' | ')} |`).join('\n')
  const title = db.inline && db.title ? `**${db.title}**\n\n` : ''
  return `${title}${head}\n${sep}${body ? '\n' + body : ''}`
}

export async function pageToMarkdown(pageId: string): Promise<string> {
  const page = useStore.getState().pages[pageId]
  if (!page) return ''
  const parts: string[] = [`# ${page.icon ? page.icon + ' ' : ''}${page.title || t('untitled')}`]
  if (page.type === 'database') {
    parts.push(databaseToMarkdown(pageId))
    return parts.join('\n\n') + '\n'
  }
  if (page.type === 'row' && page.parentId) {
    const db = useStore.getState().pages[page.parentId]
    const lines = (db?.schema ?? [])
      .filter((p) => p.type !== 'title')
      .map((p) => {
        const v = valueText(page, p)
        return v ? `- **${p.name}:** ${v}` : ''
      })
      .filter(Boolean)
    if (lines.length) parts.push(lines.join('\n'))
  }
  const doc = await getDoc(pageDocId(pageId))
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'))
  const body = md().serialize(json)
  if (body.trim()) parts.push(body.trim())
  return parts.join('\n\n') + '\n'
}

export function safeFilename(title: string): string {
  return (title || 'qirtas').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'qirtas'
}

export async function exportMarkdown(pageId: string) {
  const page = useStore.getState().pages[pageId]
  const text = await pageToMarkdown(pageId)
  await saveFile(`${safeFilename(page?.title ?? '')}.md`, text, 'text/markdown')
}

export async function exportPdf() {
  if (isNative()) {
    const { printWebView } = await import('./platform')
    await printWebView(document.title)
    return
  }
  window.print()
}

/** Plain markdown → TipTap JSON (used for AI results). */
export function markdownToJson(markdown: string) {
  return md().parse(markdown)
}
