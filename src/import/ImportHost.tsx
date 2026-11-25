// The import dialog's code (archives, Notion, Keep, Evernote…) is loaded only when it is opened.
import { lazy, Suspense } from 'react'
import { useStore } from '../data/store'

const ImportDialog = lazy(() => import('./ImportDialog'))

export function ImportHost() {
  const open = useStore((s) => s.modal === 'import')
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <ImportDialog />
    </Suspense>
  )
}
