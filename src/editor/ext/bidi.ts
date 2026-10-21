// Every block takes its direction from its first strong character, so Arabic and English
// lines live side by side without fighting each other.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { firstStrongDir } from '../../lib/arabic'

const CONTAINERS = new Set([
  'listItem',
  'taskItem',
  'blockquote',
  'callout',
  'details',
  'detailsSummary',
  'tableCell',
  'tableHeader',
])

const cache = new WeakMap<PMNode, 'rtl' | 'ltr' | null>()

function dirOf(node: PMNode): 'rtl' | 'ltr' | null {
  if (cache.has(node)) return cache.get(node)!
  let d: 'rtl' | 'ltr' | null = null
  if (node.type.name === 'codeBlock') d = 'ltr'
  else {
    // For containers, look at the first textblock that has any strong character
    node.descendants((child) => {
      if (d) return false
      if (child.isText) {
        d = firstStrongDir(child.text ?? '')
        return false
      }
      return true
    })
    if (node.isTextblock && !d) d = null
  }
  cache.set(node, d)
  return d
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock || CONTAINERS.has(node.type.name)) {
      const d = dirOf(node)
      if (d) decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: d }))
    }
    return !node.isTextblock && !node.isAtom
  })
  return DecorationSet.create(doc, decos)
}

export const bidiKey = new PluginKey<DecorationSet>('qirtasBidi')

export const AutoDirection = Extension.create({
  name: 'autoDirection',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: bidiKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations: (state) => bidiKey.getState(state),
        },
      }),
    ]
  },
})
