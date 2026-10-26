import type { AnyExtension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import type * as Y from 'yjs'
import { t } from '../../lib/i18n'
import { AutoDirection } from './bidi'
import { BlockColor, Callout, DatabaseBlock, DateChip, LocalImage, PageLink, PageMention } from './nodes'
import { SlashCommand } from './slash'
import { PageHistory } from './history'
import { pageUndoManager } from '../../data/history'

/** Extensions that define the document schema (shared by the editor and headless conversions). */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
      dropcursor: { color: 'var(--lapis)', width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    BackgroundColor,
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }),
    DetailsSummary,
    DetailsContent,
    TableKit.configure({ table: { resizable: true } }),
    Callout,
    PageLink,
    PageMention,
    DateChip,
    DatabaseBlock,
    LocalImage,
    BlockColor,
    Markdown,
  ]
}

export function editorExtensions(ydoc: Y.Doc, pageId: string): AnyExtension[] {
  return [
    ...schemaExtensions(),
    // The page's history lives for the whole session, not just while this editor is open
    Collaboration.configure({ document: ydoc, field: 'default', yUndoOptions: { undoManager: pageUndoManager(pageId, ydoc) } }),
    PageHistory.configure({ pageId }),
    AutoDirection,
    SlashCommand,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        const name = node.type.name
        if (name === 'heading') return t('placeholderHeading')
        if (name === 'detailsSummary') return t('placeholderToggle')
        if (name !== 'paragraph') return ''
        try {
          const $pos = editor.state.doc.resolve(pos)
          for (let d = $pos.depth; d > 0; d--) {
            const p = $pos.node(d).type.name
            if (p === 'taskItem') return t('placeholderTask')
            if (p === 'listItem') return t('placeholderList')
            if (p === 'blockquote') return t('placeholderQuote')
            if (p === 'callout') return t('placeholderCallout')
            if (p === 'tableCell' || p === 'tableHeader') return ''
          }
        } catch {
          /* position outside doc */
        }
        return t('placeholder')
      },
    }),
  ]
}
