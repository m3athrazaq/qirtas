// Reading what is brought in: files and folders, zip archives (also zips inside zips, as Notion
// splits big exports), text, CSV, paths, and the MD5 that Evernote uses to name pictures.
import { unzipSync } from 'fflate'

export interface Entry {
  /** Path inside what was chosen, with "/" between folders (no leading "/"). */
  path: string
  data: Uint8Array
}

/** Files the importer never looks at (system files, app settings, trash). */
const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.obsidian|\.trash|\.git|\.stfolder)(\/|$)/i
/** A file larger than this is left out (a video, a huge PDF): it would only weigh the import down. */
const MAX_FILE = 40 * 1024 * 1024

export const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirName = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const stem = (path: string) => {
  const name = baseName(path)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** "a/b/../c/./d" → "a/c/d" */
export function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Where a link written in `from` points ("../x.md", "Sub%20page%201a2b.md", "/x.md"). */
export function resolveLink(from: string, href: string): string {
  const clean = safeDecode(href.split('#')[0].split('?')[0])
  return clean.startsWith('/') ? normalize(clean) : normalize((dirName(from) ? dirName(from) + '/' : '') + clean)
}

const utf8 = new TextDecoder('utf-8')
export function text(data: Uint8Array): string {
  const s = utf8.decode(data)
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}
export const imageType = (path: string): string | null => IMAGE_TYPES[extOf(path)] ?? null

/** A copy of the bytes in a buffer of their own (fflate hands out views into the archive). */
export function blobOf(data: Uint8Array, type: string): Blob {
  return new Blob([data.slice().buffer as ArrayBuffer], { type })
}

function unzipInto(data: Uint8Array, prefix: string, out: Entry[], depth: number) {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data, { filter: (f) => !IGNORED.test(f.name) && !f.name.endsWith('/') && f.originalSize <= MAX_FILE })
  } catch {
    throw new Error('bad_zip')
  }
  for (const [name, bytes] of Object.entries(files)) {
    const path = normalize(prefix + name)
    // Notion splits a big export into several zips inside one: their contents belong together
    if (extOf(name) === 'zip' && depth < 3) unzipInto(bytes, dirName(path) ? dirName(path) + '/' : '', out, depth + 1)
    else out.push({ path, data: bytes })
  }
}

/** A file chosen or dropped, with its path inside a chosen folder. */
export interface Picked {
  file: File
  path?: string
}

/** Everything chosen (files, a folder, archives) as one list of files. */
export async function readEntries(files: Picked[]): Promise<Entry[]> {
  const out: Entry[] = []
  for (const { file: f, path: given } of files) {
    const path = normalize(given || (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
    if (IGNORED.test(path) || f.size > MAX_FILE * 4) continue
    const data = new Uint8Array(await f.arrayBuffer())
    if (extOf(path) === 'zip') unzipInto(data, '', out, 0)
    else if (f.size <= MAX_FILE) out.push({ path, data })
  }
  // A single folder around everything (the archive's own folder, the vault's name) is not a level of its own
  for (;;) {
    const first = out[0]?.path.split('/')[0]
    if (!first || out.some((e) => !e.path.startsWith(first + '/'))) break
    out.forEach((e) => (e.path = e.path.slice(first.length + 1)))
  }
  return out
}

// ---------------------------------------------------------------- CSV

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes; "," or ";" or tab. */
export function parseCsv(src: string): string[][] {
  const nl = src.indexOf('\n')
  const head = nl < 0 ? src : src.slice(0, nl)
  const sep = [',', ';', '\t'].map((c) => [c, head.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------- MD5 (Evernote names its pictures by it)

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5(data: Uint8Array): string {
  const len = data.length
  const words = new Uint32Array((((len + 8) >>> 6) + 1) * 16)
  for (let i = 0; i < len; i++) words[i >> 2] |= data[i] << ((i % 4) * 8)
  words[len >> 2] |= 0x80 << ((len % 4) * 8)
  words[words.length - 2] = (len * 8) >>> 0
  words[words.length - 1] = Math.floor(len / 0x20000000)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  for (let off = 0; off < words.length; off += 16) {
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      const x = (a + f + K[i] + words[off + g]) >>> 0
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  return [a0, b0, c0, d0].map((w) => Array.from({ length: 4 }, (_, i) => ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('')).join('')
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
