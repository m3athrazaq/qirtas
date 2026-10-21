// Custom blocks: callout, sub-page link, inline page mention, Hijri/Gregorian date chip,
// inline database, and images stored on the device.
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutView, DatabaseBlockView, DateChipView, ImageView, PageLinkView, PageMentionView } from '../views'
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
  addAttributes() {
    return {
      ...this.parent?.(),
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
