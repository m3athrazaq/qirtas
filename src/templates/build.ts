// Small helpers to describe page content as TipTap JSON and write it into a page's Yjs doc.
import { getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { getDoc, pageDocId } from '../data/docs'
import { ws } from '../data/store'
import { schemaExtensions } from '../editor/ext'

let schema: ReturnType<typeof getSchema> | null = null
function getPmSchema() {
  if (!schema) schema = getSchema(schemaExtensions())
  return schema
}

type Inline = string | JSONContent

const inl = (x: Inline): JSONContent => (typeof x === 'string' ? { type: 'text', text: x } : x)
const content = (xs: Inline[]) => xs.filter((x) => x !== '').map(inl)

export const doc = (...c: JSONContent[]): JSONContent => ({ type: 'doc', content: c })
export const p = (...c: Inline[]): JSONContent => (c.length ? { type: 'paragraph', content: content(c) } : { type: 'paragraph' })
export const h1 = (...c: Inline[]): JSONContent => ({ type: 'heading', attrs: { level: 1 }, content: content(c) })
export const h2 = (...c: Inline[]): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: content(c) })
export const h3 = (...c: Inline[]): JSONContent => ({ type: 'heading', attrs: { level: 3 }, content: content(c) })
export const b = (text: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'bold' }] })
export const i = (text: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'italic' }] })
export const hl = (text: string, color = 'yellow'): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { backgroundColor: `var(--hl-${color})` } }] })
export const code = (text: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'code' }] })
export const bullets = (...items: (Inline | Inline[])[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((it) => ({ type: 'listItem', content: [p(...(Array.isArray(it) ? it : [it]))] })),
})
export const numbered = (...items: (Inline | Inline[])[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((it) => ({ type: 'listItem', content: [p(...(Array.isArray(it) ? it : [it]))] })),
})
export const tasks = (...items: (string | [string, boolean] | Inline[])[]): JSONContent => ({
  type: 'taskList',
  content: items.map((it) => {
    if (typeof it === 'string') return { type: 'taskItem', attrs: { checked: false }, content: [p(it)] }
    if (it.length === 2 && typeof it[1] === 'boolean') return { type: 'taskItem', attrs: { checked: it[1] }, content: [p(it[0] as string)] }
    return { type: 'taskItem', attrs: { checked: false }, content: [p(...(it as Inline[]))] }
  }),
})
export const callout = (icon: string, color: string, ...blocks: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { icon, color }, content: blocks })
export const quote = (...blocks: JSONContent[]): JSONContent => ({ type: 'blockquote', content: blocks })
export const hr = (): JSONContent => ({ type: 'horizontalRule' })
export const toggle = (summary: string, ...blocks: JSONContent[]): JSONContent => ({
  type: 'details',
  attrs: { open: false },
  content: [
    { type: 'detailsSummary', content: [{ type: 'text', text: summary }] },
    { type: 'detailsContent', content: blocks.length ? blocks : [p()] },
  ],
})
export const date = (iso: string): JSONContent => ({ type: 'dateChip', attrs: { date: iso } })
export const dbBlock = (id: string): JSONContent => ({ type: 'database', attrs: { databaseId: id } })
export const pageLink = (id: string): JSONContent => ({ type: 'pageLink', attrs: { pageId: id } })
export const table = (rows: string[][]): JSONContent => ({
  type: 'table',
  content: rows.map((r, ri) => ({
    type: 'tableRow',
    content: r.map((c) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [p(c)] })),
  })),
})

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  const inner = (node.content ?? []).map(plainText)
  const block = ['paragraph', 'heading', 'listItem', 'taskItem', 'detailsSummary', 'tableCell', 'tableHeader'].includes(node.type ?? '')
  return inner.join(block ? '' : '\n') + (block ? '\n' : '')
}

/** Replace a page's content with the given document JSON. */
export async function setPageContent(pageId: string, json: JSONContent) {
  const ydoc = await getDoc(pageDocId(pageId))
  const frag = ydoc.getXmlFragment('default')
  ydoc.transact(() => {
    if (frag.length) frag.delete(0, frag.length)
    prosemirrorJSONToYXmlFragment(getPmSchema(), json, frag)
  })
  ws().setText(pageId, plainText(json).replace(/\n{2,}/g, '\n').trim())
}
