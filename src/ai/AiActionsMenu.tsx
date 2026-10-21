import type { Editor } from '@tiptap/react'
import { CheckCheck, Languages, ListChecks, ListCollapse, MessageSquareText, PenLine, Scissors, SpellCheck, Sparkles, WholeWord } from 'lucide-react'
import { t, type Key } from '../lib/i18n'
import { MenuItem } from '../ui/Popover'
import { openAi, type AiAction } from './aiBus'

export const AI_ACTIONS: { action: AiAction; label: Key; icon: typeof Sparkles }[] = [
  { action: 'continue', label: 'aiContinue', icon: PenLine },
  { action: 'summarize', label: 'aiSummarize', icon: ListCollapse },
  { action: 'fix', label: 'aiFix', icon: SpellCheck },
  { action: 'fusha', label: 'aiFusha', icon: WholeWord },
  { action: 'toEnglish', label: 'aiToEnglish', icon: Languages },
  { action: 'toArabic', label: 'aiToArabic', icon: Languages },
  { action: 'shorter', label: 'aiShorter', icon: Scissors },
  { action: 'longer', label: 'aiLonger', icon: MessageSquareText },
  { action: 'tasks', label: 'aiTasks', icon: ListChecks },
]

export function AiActionsMenu({ editor, onDone }: { editor: Editor; onDone?: () => void }) {
  return (
    <div className="menu-list">
      {AI_ACTIONS.map(({ action, label, icon: Icon }) => (
        <MenuItem
          key={action}
          icon={<Icon size={15} />}
          label={t(label)}
          onClick={() => {
            onDone?.()
            openAi(editor, { action })
          }}
        />
      ))}
      <MenuItem
        icon={<CheckCheck size={15} />}
        label={t('aiAsk')}
        onClick={() => {
          onDone?.()
          openAi(editor)
        }}
      />
    </div>
  )
}
