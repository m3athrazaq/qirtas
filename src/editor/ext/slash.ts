import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { SlashMenu, type SlashMenuHandle } from '../SlashMenu'
import { filterSlashItems, type SlashItem } from '../slashItems'

export const slashKey = new PluginKey('slashCommand')

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashKey,
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        allowedPrefixes: [' ', ' '],
        items: ({ query, editor }) => filterSlashItems(query, editor),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          props.run(editor, range)
        },
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle> | null = null
          let floating: HTMLDivElement | null = null
          let current: SuggestionProps<SlashItem, SlashItem> | null = null

          const place = () => {
            if (!floating || !current?.clientRect) return
            const rect = current.clientRect()
            if (!rect) return
            const virtual = { getBoundingClientRect: () => rect }
            void computePosition(virtual, floating, {
              placement: 'bottom-start',
              strategy: 'fixed',
              middleware: [
                offset(6),
                flip({ padding: 8 }),
                shift({ padding: 8 }),
                size({
                  padding: 8,
                  apply({ availableHeight, elements }) {
                    elements.floating.style.maxHeight = `${Math.max(160, Math.min(380, availableHeight))}px`
                  },
                }),
              ],
            }).then(({ x, y }) => {
              if (floating) Object.assign(floating.style, { left: `${x}px`, top: `${y}px` })
            })
          }

          return {
            onStart: (props) => {
              current = props
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor })
              floating = document.createElement('div')
              floating.className = 'floating slash-floating'
              floating.style.position = 'fixed'
              floating.dir = document.documentElement.dir
              floating.appendChild(renderer.element)
              document.body.appendChild(floating)
              place()
            },
            onUpdate: (props) => {
              current = props
              renderer?.updateProps(props)
              place()
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                floating?.remove()
                floating = null
                return true
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              floating?.remove()
              floating = null
              renderer?.destroy()
              renderer = null
              current = null
            },
          }
        },
      }),
    ]
  },
})
