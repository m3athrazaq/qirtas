// Connects an editor to the app-wide undo history (see data/history.ts).
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { canRedo, canUndo, historyRedo, historyUndo, PageUndoManager, registerEditorState } from '../../data/history'

export const PageHistory = Extension.create<{ pageId: string }>({
  name: 'pageHistory',

  addOptions() {
    return { pageId: '' }
  },

  // Same names as the Collaboration extension's commands; extensions later in the list win,
  // so these replace them: undo takes back the latest change, in the text or in the workspace.
  addCommands() {
    const pageId = () => this.options.pageId
    return {
      undo:
        () =>
        ({ tr, state, dispatch }) => {
          tr.setMeta('preventDispatch', true)
          if (!dispatch) return canUndo(pageId())
          return historyUndo(pageId(), state)
        },
      redo:
        () =>
        ({ tr, state, dispatch }) => {
          tr.setMeta('preventDispatch', true)
          if (!dispatch) return canRedo(pageId())
          return historyRedo(pageId(), state)
        },
    }
  },

  // Handled even when there is nothing to undo, so the browser's own undo never runs on the page
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => {
        this.editor.commands.undo()
        return true
      },
      'Mod-y': () => {
        this.editor.commands.redo()
        return true
      },
      'Shift-Mod-z': () => {
        this.editor.commands.redo()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const pageId = this.options.pageId
    return [
      new Plugin({
        view: (view) => {
          const um = yUndoPluginKey.getState(view.state)?.undoManager
          // The history outlives this view: take back the listeners the view's undo plugin added
          const claimed = um instanceof PageUndoManager ? um.claimViewListeners() : []
          const unregister = registerEditorState(pageId, () => view.state)
          return {
            destroy: () => {
              unregister()
              if (um instanceof PageUndoManager) um.releaseViewListeners(claimed)
            },
          }
        },
      }),
    ]
  },
})
