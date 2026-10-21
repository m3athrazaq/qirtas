import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getDoc, pageDocId } from '../data/docs'
import { importImage } from '../data/assets'
import { getActiveEditor } from '../editor/PageEditor'
import { todayIso } from './hijri'
import { setPageContent } from '../templates/build'

/** Put shared text/links/images at the top of the Inbox page. */
export async function addToInbox(pageId: string, shared: { text?: string; subject?: string; image?: string }): Promise<string> {
  const blocks: JSONContent[] = []
  const head: JSONContent[] = [{ type: 'dateChip', attrs: { date: todayIso() } }]
  if (shared.subject) head.push({ type: 'text', text: ' ' + shared.subject, marks: [{ type: 'bold' }] })
  blocks.push({ type: 'paragraph', content: head })
  if (shared.text) {
    for (const line of shared.text.split(/\n+/).filter(Boolean)) {
      const url = line.trim().match(/^https?:\/\/\S+$/)
      blocks.push({
        type: 'paragraph',
        content: [url ? { type: 'text', text: line.trim(), marks: [{ type: 'link', attrs: { href: line.trim() } }] } : { type: 'text', text: line }],
      })
    }
  }
  if (shared.image) {
    try {
      const res = await fetch(shared.image)
      const src = await importImage(await res.blob())
      blocks.push({ type: 'image', attrs: { src } })
    } catch {
      /* image unavailable */
    }
  }
  blocks.push({ type: 'horizontalRule' })

  const editor = getActiveEditor(pageId)
  if (editor && !editor.isDestroyed) {
    editor.chain().insertContentAt(0, blocks).run()
    return pageId
  }
  const doc = await getDoc(pageDocId(pageId))
  const current = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JSONContent
  await setPageContent(pageId, { type: 'doc', content: [...blocks, ...(current.content ?? [])] })
  return pageId
}
