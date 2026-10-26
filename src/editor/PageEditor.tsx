import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { getDoc, pageDocId } from '../data/docs'
import { useStore, ws } from '../data/store'
import { editorExtensions } from './ext'
import { insertImageFile, setEditorPage } from './actions'
import { BlockHandle } from './BlockHandle'
import { BubbleToolbar } from './BubbleToolbar'
import { KeyboardBar } from './KeyboardBar'
import { TableControls } from './TableControls'
import { Quiet } from '../ui/ErrorBoundary'

/** The live editor showing a page, if that page is open on screen. */
export function getActiveEditor(pageId: string): Editor | undefined {
  const el = document.querySelector(`[data-editor-page="${pageId}"] .ProseMirror`) as (HTMLElement & { editor?: Editor }) | null
  const ed = el?.editor
  return ed && !ed.isDestroyed ? ed : undefined
}

export function PageEditor({ pageId, editable = true, onReady }: { pageId: string; editable?: boolean; onReady?: (e: Editor) => void }) {
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  useEffect(() => {
    let alive = true
    setDoc(null)
    void getDoc(pageDocId(pageId)).then((d) => alive && setDoc(d))
    return () => {
      alive = false
    }
  }, [pageId])
  if (!doc) return <div className="editor-loading" />
  return <EditorInner key={pageId} pageId={pageId} doc={doc} editable={editable} onReady={onReady} />
}

function EditorInner({ pageId, doc, editable, onReady }: { pageId: string; doc: Y.Doc; editable: boolean; onReady?: (e: Editor) => void }) {
  const lang = useStore((s) => s.settings.lang)
  const isMobile = useStore((s) => s.isMobile)
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor(
    {
      extensions: editorExtensions(doc, pageId),
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { dir: lang === 'ar' ? 'rtl' : 'ltr', class: 'prose', spellcheck: 'true' },
        handlePaste: (view, event) => {
          const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          const ed = (view.dom as HTMLElement & { editor?: Editor }).editor
          if (ed) files.forEach((f) => void insertImageFile(ed, f))
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false
          const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          const ed = (view.dom as HTMLElement & { editor?: Editor }).editor
          if (ed) files.forEach((f) => void insertImageFile(ed, f, pos))
          return true
        },
      },

      onUpdate: ({ editor: e, transaction }) => {
        if (!transaction.docChanged) return
        // Changes that came from sync (or the first load) don't count as the user's edits
        const meta = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined
        if (!meta?.isChangeOrigin) {
          try {
            ws().touchSeed(pageId)
          } catch {
            /* closed */
          }
        }
        if (textTimer.current) clearTimeout(textTimer.current)
        textTimer.current = setTimeout(() => {
          try {
            ws().setText(pageId, e.getText({ blockSeparator: '\n' }))
          } catch {
            /* workspace closed */
          }
        }, 700)
      },
    },
    [doc, pageId],
  )

  // Register the live editor (React may create and discard one while mounting)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setEditorPage(editor, pageId)
    onReady?.(editor)
  }, [editor, pageId, onReady])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    if (!editor) return
    editor.view.dom.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
  }, [editor, lang])

  useEffect(
    () => () => {
      if (textTimer.current) {
        clearTimeout(textTimer.current)
        try {
          if (editor && !editor.isDestroyed) ws().setText(pageId, editor.getText({ blockSeparator: '\n' }))
        } catch {
          /* ignore */
        }
      }
    },
    [editor, pageId],
  )

  if (!editor) return null
  return (
    <div className="editor-wrap" data-editor-page={pageId}>
      <EditorContent editor={editor} className="editor" />
      {editable && !isMobile && (
        <Quiet>
          <BlockHandle editor={editor} />
        </Quiet>
      )}
      {editable && (
        <Quiet>
          <BubbleToolbar editor={editor} />
        </Quiet>
      )}
      {editable && (
        <Quiet>
          <TableControls editor={editor} />
        </Quiet>
      )}
      {editable && isMobile && (
        <Quiet>
          <KeyboardBar editor={editor} />
        </Quiet>
      )}
    </div>
  )
}
