// Turning notes written elsewhere into Qirtas pages: Markdown as Notion and Obsidian write it
// (wiki links, embeds, callouts, front matter), plain text, and the clean-up every imported page
// goes through (links between imported pages become mentions, pictures are found, line breaks kept).
import type { JSONContent } from '@tiptap/core'
import { safeDecode } from './util'

/** Marks left in the Markdown for the clean-up to find. */
const WIKI = 'qimport-wiki:'
const EMBED = 'qimport-embed:'
/** A picture that is part of the import, by its path; turned into a stored picture when imported. */
export const ASSET = 'qimport-asset:'
/** A page of the import, by its key; becomes the new page's id. */
export const PAGE = 'qimport:'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

// ---------------------------------------------------------------- front matter

/** "---\nkey: value\n---" at the top of a note: its lines, and the rest. */
export function splitFrontMatter(src: string): { meta: [string, string][]; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src)
  if (!m) return { meta: [], body: src }
  const entries: { key: string; values: string[] }[] = []
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    const last = entries[entries.length - 1]
    if (item && last) {
      last.values.push(unquote(item[1]))
      continue
    }
    const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    const values = v === '' ? [] : v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map(unquote).filter(Boolean) : [unquote(v)]
    entries.push({ key: kv[1].trim(), values })
  }
  return { meta: entries.filter((e) => e.values.length).map((e) => [e.key, e.values.join('، ')]), body: src.slice(m[0].length) }
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2')

// ---------------------------------------------------------------- before parsing

/** Obsidian's and Notion's own syntax, rewritten as plain Markdown the parser reads. */
export function prepareMarkdown(src: string): string {
  return (
    src
      // Obsidian comments and block ids
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/[ \t]\^[A-Za-z0-9-]+$/gm, '')
      // ![[picture.png|300]] and ![[Another note]]
      .replace(/!\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, _h, alias: string | undefined) => {
        const t = target.trim()
        if (IMAGE_EXT.test(t)) return `![${/^\d+(x\d+)?$/.test(alias ?? '') ? '' : (alias ?? '')}](${EMBED}${encodeURIComponent(t)})`
        return `[${t}](${WIKI}${encodeURIComponent(t)})`
      })
      // [[Note]], [[Note|shown text]], [[Note#Heading]]
      .replace(/\[\[([^\]|#\n]*)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, heading: string | undefined, alias: string | undefined) => {
        const t = target.trim()
        const shown = (alias ?? (t || (heading ?? '').slice(1))).replace(/[[\]]/g, '')
        return t ? `[${shown}](${WIKI}${encodeURIComponent(t)})` : shown
      })
      // Notion's callouts: <aside>💡 text</aside>
      .replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_, inner: string) => {
        const lines = inner.replace(/<\/?[a-z][^>]*>/gi, '').split(/\r?\n/)
        return '\n' + lines.map((l, i) => (i === 0 ? `> [!aside] ${l}` : `> ${l}`)).join('\n') + '\n'
      })
  )
}

// ---------------------------------------------------------------- after parsing

export interface LinkContext {
  /** The page a link written in this note points to ("Other%20page.md", "../x.md"), if it is imported. */
  page(href: string): string | null
  /** The page a wiki link names ([[Other page]]). */
  wiki(name: string): string | null
  /** The imported picture a path or an embed names. */
  image(src: string, embed: boolean): string | null
  /** Pages directly under this one: a line that only links to one of them shows it as a sub-page. */
  children: Set<string>
}

const CALLOUTS: Record<string, [string, string]> = {
  note: ['📝', 'blue'],
  info: ['ℹ️', 'blue'],
  abstract: ['📋', 'blue'],
  summary: ['📋', 'blue'],
  tldr: ['📋', 'blue'],
  todo: ['☑️', 'blue'],
  tip: ['💡', 'green'],
  hint: ['💡', 'green'],
  important: ['❗', 'orange'],
  success: ['✅', 'green'],
  check: ['✅', 'green'],
  done: ['✅', 'green'],
  question: ['❓', 'purple'],
  help: ['❓', 'purple'],
  faq: ['❓', 'purple'],
  warning: ['⚠️', 'yellow'],
  caution: ['⚠️', 'yellow'],
  attention: ['⚠️', 'yellow'],
  failure: ['❌', 'red'],
  fail: ['❌', 'red'],
  missing: ['❌', 'red'],
  danger: ['⛔', 'red'],
  error: ['⛔', 'red'],
  bug: ['🐞', 'red'],
  example: ['🧪', 'purple'],
  quote: ['💬', 'gray'],
  cite: ['💬', 'gray'],
}

const EMOJI_START = /^(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)\s*/u

const textOf = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join(''))

/** "> [!tip] Title" (Obsidian) and "> [!aside] 💡 text" (Notion) become callouts. */
function callout(node: JSONContent): JSONContent | null {
  const first = node.content?.[0]
  const t0 = first?.type === 'paragraph' ? first.content?.[0] : undefined
  if (t0?.type !== 'text') return null
  const m = /^\[!([a-z-]+)\][+-]?[ \t]*/i.exec(t0.text ?? '')
  if (!m) return null
  const kind = m[1].toLowerCase()
  let rest = (t0.text ?? '').slice(m[0].length)
  let [icon, color] = CALLOUTS[kind] ?? ['💡', 'gray']
  if (kind === 'aside') {
    const e = EMOJI_START.exec(rest)
    if (e) {
      icon = e[1]
      rest = rest.slice(e[0].length)
    }
  }
  // The rest of the marker's line: the callout's title (Obsidian) or its first words (Notion)
  const nl = rest.indexOf('\n')
  const title = nl < 0 ? rest : rest.slice(0, nl)
  const after = nl < 0 ? '' : rest.slice(nl + 1)
  const firstContent = [...(after ? [{ ...t0, text: after }] : []), ...(first!.content ?? []).slice(1)]
  const blocks: JSONContent[] = []
  if (title.trim()) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: title.trim(), marks: kind === 'aside' ? undefined : [{ type: 'bold' }] }] })
  if (firstContent.length) blocks.push({ ...first!, content: firstContent })
  blocks.push(...(node.content ?? []).slice(1))
  return { type: 'callout', attrs: { icon, color }, content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}

/** Text with "\n" in it: separate lines (as the note showed them). */
function splitLines(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text?.includes('\n')) {
      out.push(n)
      continue
    }
    n.text.split('\n').forEach((part, i) => {
      if (i) out.push({ type: 'hardBreak' })
      if (part) out.push({ ...n, text: part })
    })
  }
  // no break at the very start or end of a line
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  return out
}

/** Links to other imported pages become mentions of them; links that lead nowhere become text. */
function links(nodes: JSONContent[], ctx: LinkContext): JSONContent[] {
  const out: JSONContent[] = []
  let lastKey: string | null = null
  for (const n of nodes) {
    const link = n.type === 'text' ? n.marks?.find((m) => m.type === 'link') : undefined
    const href = (link?.attrs?.href as string | undefined) ?? ''
    if (!link || /^(https?:|mailto:|tel:|#)/i.test(href)) {
      out.push(n)
      lastKey = null
      continue
    }
    const key = href.startsWith(WIKI) ? ctx.wiki(safeDecode(href.slice(WIKI.length))) : /^[a-z][a-z0-9+.-]*:/i.test(href) ? null : ctx.page(href)
    if (key) {
      // the words of one link may come in several pieces (bold in the middle): one mention
      if (key !== lastKey) out.push({ type: 'pageMention', attrs: { pageId: PAGE + key } })
      lastKey = key
      continue
    }
    lastKey = null
    const marks = n.marks!.filter((m) => m !== link)
    out.push({ ...n, marks: marks.length ? marks : undefined })
  }
  return out
}

function image(node: JSONContent, ctx: LinkContext): JSONContent {
  const src = (node.attrs?.src as string | undefined) ?? ''
  if (/^(https?:|data:image\/)/i.test(src)) return node
  const embed = src.startsWith(EMBED)
  const path = ctx.image(embed ? safeDecode(src.slice(EMBED.length)) : src, embed)
  if (path) return { ...node, attrs: { ...node.attrs, src: ASSET + path } }
  const name = (embed ? safeDecode(src.slice(EMBED.length)) : safeDecode(src.split('/').pop() ?? src)) || 'image'
  return { type: 'paragraph', content: [{ type: 'text', text: `🖼️ ${name}`, marks: [{ type: 'italic' }] }] }
}

/** The clean-up every imported page goes through. */
export function finishDoc(doc: JSONContent, ctx: LinkContext): JSONContent {
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === 'image') return image(node, ctx)
    if (node.type === 'codeBlock') return node
    if (node.type === 'blockquote') {
      const c = callout(node)
      if (c) node = c
    }
    if (!node.content) return node
    let content = node.content
    if (content.some((c) => c.type === 'text')) content = splitLines(links(content, ctx))
    content = content.map(visit)
    // A line that is only a link to a page right under this one: that page, shown as a sub-page
    if (node.type === 'doc' || node.type === 'callout' || node.type === 'blockquote' || node.type === 'detailsContent') {
      content = content.map((b) => {
        const only = b.type === 'paragraph' && b.content?.length === 1 ? b.content[0] : null
        const id = only?.type === 'pageMention' ? (only.attrs?.pageId as string) : null
        return id && ctx.children.has(id.slice(PAGE.length)) ? { type: 'pageLink', attrs: { pageId: id } } : b
      })
    }
    return { ...node, content }
  }
  const out = visit(doc)
  if (!out.content?.length) out.content = [{ type: 'paragraph' }]
  return out
}

/** The first heading, when it only repeats the title (Notion starts every page with it). */
export function dropTitleHeading(doc: JSONContent, title: string): JSONContent {
  const first = doc.content?.[0]
  if (first?.type === 'heading' && first.attrs?.level === 1 && textOf(first).trim() === title.trim()) return { ...doc, content: doc.content!.slice(1) }
  return doc
}

const URL_RE = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?،؛]/g

/** Plain text with its web addresses as links. */
export function linkify(line: string): JSONContent[] {
  const out: JSONContent[] = []
  let at = 0
  for (const m of line.matchAll(URL_RE)) {
    if (m.index! > at) out.push({ type: 'text', text: line.slice(at, m.index) })
    out.push({ type: 'text', text: m[0], marks: [{ type: 'link', attrs: { href: m[0] } }] })
    at = m.index! + m[0].length
  }
  if (at < line.length) out.push({ type: 'text', text: line.slice(at) })
  return out
}

/** Plain text: a paragraph for each line. */
export function textBlocks(src: string): JSONContent[] {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? { type: 'paragraph', content: linkify(line) } : { type: 'paragraph' }))
}

/** "key: value" lines (front matter, a note's tags), shown at the top of the page. */
export function propsBlock(meta: [string, string][]): JSONContent | null {
  if (!meta.length) return null
  return {
    type: 'callout',
    attrs: { icon: '🏷️', color: 'gray' },
    content: meta.map(([k, v]) => ({ type: 'paragraph', content: [{ type: 'text', text: k + ': ', marks: [{ type: 'bold' }] }, ...linkify(v)] })),
  }
}
