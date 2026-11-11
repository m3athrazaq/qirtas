// Things the app can be asked to do from outside a page: a keyboard shortcut, the command list in
// search, a shortcut of the installed app (#/today…), a link from the Android launcher.
import { navigate } from './nav'
import { useStore, ws } from './store'
import { openToday } from './today'

export type AppAction = 'new' | 'search' | 'today' | 'capture' | 'tasks' | 'shortcuts'

export function runAction(a: AppAction) {
  const st = useStore.getState()
  if (!st.ready) return
  const canEdit = st.wsRole !== 'viewer'
  if ((a === 'new' || a === 'today') && st.modal) st.closeModal()
  if (a === 'new') {
    if (canEdit) navigate(ws().createPage({ parentId: null }))
  } else if (a === 'today') void openToday()
  else if (a === 'capture') {
    if (canEdit) st.openModal('capture')
  } else st.openModal(a)
}
