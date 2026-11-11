// Custom blocks: callout, sub-page link, inline page mention, Hijri/Gregorian date chip,
// inline database, and images stored on the device.
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { uid } from '../../lib/ids'
import { CalloutView, DatabaseBlockView, DateChipView, ImageView, PageLinkView, PageMentionView } from '../views'
import { ReminderView } from '../views/ReminderView'
import { markdownHooks } from './markdownHooks'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { icon?: string; color?: string }) => ReturnType
      toggleCallout: () => ReturnType
    }
    blockColor: {
      setBlockColor: (color: string | null) => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-icon') || '💡',
        renderHTML: (a) => ({ 'data-icon': a.icon }),
      },
      color: {
        default: 'gray',
        parseHTML: (el) => el.getAttribute('data-color') || 'gray',
        renderHTML: (a) => ({ 'data-color': a.color }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView, {
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('.callout-icon'),
    })
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        () =>
        ({ commands, editor }) =>
          editor.isActive(this.name) ? commands.lift(this.name) : commands.wrapIn(this.name),
    }
  },
  renderMarkdown(node, h) {
    const icon = (node.attrs?.icon as string) || '💡'
    const inner = h.renderChildren(node.content ?? [], '\n\n')
    return inner
      .split('\n')
      .map((l, i) => `> ${i === 0 ? icon + ' ' : ''}${l}`)
      .join('\n')
  },
})

export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-page-id'),
        renderHTML: (a) => ({ 'data-page-id': a.pageId }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-page-link]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-link': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },
  renderMarkdown(node) {
    return markdownHooks.pageLink(node.attrs?.pageId as string)
  },
})

export const PageMention = Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-page-id'),
        renderHTML: (a) => ({ 'data-page-id': a.pageId }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-page-mention]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-page-mention': '' })]
  },
  renderText({ node }) {
    return markdownHooks.pageTitle(node.attrs.pageId)
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageMentionView, { as: 'span' })
  },
  renderMarkdown(node) {
    return markdownHooks.pageLink(node.attrs?.pageId as string)
  },
})

export const DateChip = Node.create({
  name: 'dateChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      date: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-date'),
        renderHTML: (a) => ({ 'data-date': a.date }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-date-chip]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-date-chip': '' })]
  },
  renderText({ node }) {
    return markdownHooks.date(node.attrs.date)
  },
  addNodeView() {
    return ReactNodeViewRenderer(DateChipView, { as: 'span' })
  },
  renderMarkdown(node) {
    return markdownHooks.date(node.attrs?.date as string)
  },
})

/** A reminder: a moment at which the app notifies you. Sits in the text like a date chip; inside a
 *  task it belongs to that task (checking the task silences it). */
export const Reminder = Node.create({
  name: 'reminder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (a) => (a.id ? { 'data-id': a.id } : {}),
      },
      at: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-at')) || null,
        renderHTML: (a) => (a.at ? { 'data-at': String(a.at) } : {}),
      },
      done: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-done') === 'true',
        renderHTML: (a) => (a.done ? { 'data-done': 'true' } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-reminder]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-reminder': '' })]
  },
  renderText({ node }) {
    return markdownHooks.reminder(node.attrs.at)
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReminderView, { as: 'span' })
  },
  renderMarkdown(node) {
    return markdownHooks.reminder(node.attrs?.at as number)
  },
  addProseMirrorPlugins() {
    // Every reminder has its own id: a copied or pasted one gets a new id (it is a second reminder)
    return [
      new Plugin({
        key: new PluginKey('reminderIds'),
        appendTransaction: (trs, _old, state) => {
          // Only when a change brought reminders in (typing elsewhere doesn't walk the document)
          if (!trs.some((tr) => tr.docChanged && tr.steps.some((s) => bringsReminder((s as unknown as { slice?: Slice }).slice)))) return null
          const seen = new Set<string>()
          const fix: number[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'reminder') return
            const id = node.attrs.id as string | null
            if (!id || seen.has(id)) fix.push(pos)
            else seen.add(id)
          })
          if (!fix.length) return null
          const tr = state.tr
          fix.forEach((pos) => tr.setNodeAttribute(pos, 'id', uid()))
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})

function bringsReminder(slice: Slice | undefined): boolean {
  if (!slice || !slice.size) return false
  let found = false
  slice.content.descendants((n) => {
    if (found) return false
    if (n.type.name === 'reminder') found = true
  })
  return found
}

export const DatabaseBlock = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (a) => ({ 'data-database-id': a.databaseId }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-database]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-database': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView, {
      stopEvent: ({ event }) => !event.type.startsWith('drag') && event.type !== 'drop',
      ignoreMutation: () => true,
    })
  },
  renderMarkdown(node) {
    return markdownHooks.database(node.attrs?.databaseId as string)
  },
})

export const LocalImage = Image.extend({
  draggable: true,
  parseHTML() {
    return [{ tag: 'img[src]' }, { tag: 'img[data-asset]' }]
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      // Pictures kept on the device are "asset:<id>"; in plain HTML they travel as data-asset
      // so the browser never tries to load that address.
      src: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-asset') ? `asset:${el.getAttribute('data-asset')}` : el.getAttribute('src')),
        renderHTML: (a) => {
          const src = a.src as string | null
          return src?.startsWith('asset:') ? { 'data-asset': src.slice(6) } : { src }
        },
      },
      width: {
        default: 100,
        parseHTML: (el) => Number(el.getAttribute('data-width')) || 100,
        renderHTML: (a) => ({ 'data-width': a.width }),
      },
      align: {
        default: 'center',
        parseHTML: (el) => el.getAttribute('data-align') || 'center',
        renderHTML: (a) => ({ 'data-align': a.align }),
      },
      caption: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-caption') || '',
        renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.classList?.contains('img-handle'),
    })
  },
}).configure({ inline: false, allowBase64: true })

const COLOR_TYPES = ['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem', 'details']

export const BlockColor = Extension.create({
  name: 'blockColor',
  addGlobalAttributes() {
    return [
      {
        types: COLOR_TYPES,
        attributes: {
          blockColor: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-block-color'),
            renderHTML: (a) => (a.blockColor ? { 'data-block-color': a.blockColor } : {}),
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      setBlockColor:
        (color) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection
          let changed = false
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (COLOR_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockColor: color })
              changed = true
              // color list items as a whole, not their inner paragraphs
              if (node.type.name === 'listItem' || node.type.name === 'taskItem') return false
            }
            return true
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
