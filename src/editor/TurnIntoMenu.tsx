import type { Editor } from '@tiptap/react'
import { Check, Code2, Heading1, Heading2, Heading3, Lightbulb, List, ListChecks, ListCollapse, ListOrdered, Quote, Text } from 'lucide-react'
import { t, type Key } from '../lib/i18n'
import { MenuItem } from '../ui/Popover'
import { activeKind, turnInto, type BlockKind } from './actions'

export const KINDS: { kind: BlockKind; label: Key; icon: typeof Text }[] = [
  { kind: 'paragraph', label: 'bText', icon: Text },
  { kind: 'h1', label: 'bH1', icon: Heading1 },
  { kind: 'h2', label: 'bH2', icon: Heading2 },
  { kind: 'h3', label: 'bH3', icon: Heading3 },
  { kind: 'task', label: 'bTask', icon: ListChecks },
  { kind: 'bullet', label: 'bBullet', icon: List },
  { kind: 'ordered', label: 'bNumbered', icon: ListOrdered },
  { kind: 'toggle', label: 'bToggle', icon: ListCollapse },
  { kind: 'quote', label: 'bQuote', icon: Quote },
  { kind: 'callout', label: 'bCallout', icon: Lightbulb },
  { kind: 'code', label: 'bCode', icon: Code2 },
]

export function TurnIntoMenu({ editor, onDone }: { editor: Editor; onDone?: () => void }) {
  const current = activeKind(editor)
  return (
    <div className="menu-list">
      {KINDS.map(({ kind, label, icon: Icon }) => (
        <MenuItem
          key={kind}
          icon={<Icon size={16} strokeWidth={1.6} />}
          label={t(label)}
          active={kind === current}
          trailing={kind === current ? <Check size={14} className="menu-check" /> : null}
          onClick={() => {
            turnInto(editor, kind)
            onDone?.()
          }}
        />
      ))}
    </div>
  )
}
