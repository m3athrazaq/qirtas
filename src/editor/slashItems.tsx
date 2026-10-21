import type { Editor, Range } from '@tiptap/core'
import {
  CalendarCheck2,
  CalendarDays,
  Code2,
  FileText,
  Grid3x3,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  Mic,
  Minus,
  Quote,
  Sparkles,
  SquareKanban,
  Table2,
  Text,
  CalendarSearch,
  type LucideIcon,
} from 'lucide-react'
import { matchScore } from '../lib/arabic'
import { t, tIn, type Key } from '../lib/i18n'
import { openAi, openVoice } from '../ai/aiBus'
import {
  insertDatabase,
  insertDate,
  insertDivider,
  insertImage,
  insertPageMention,
  insertSimpleTable,
  insertSubPage,
  turnInto,
} from './actions'

export type SlashGroup = 'blocksBasic' | 'blocksMedia' | 'blocksData' | 'blocksInsert' | 'blocksAi'

export interface SlashItem {
  id: string
  title: Key
  desc: Key
  icon: LucideIcon
  group: SlashGroup
  keywords: string[]
  hint?: string
  run: (editor: Editor, range: Range) => void
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', title: 'bText', desc: 'bTextDesc', icon: Text, group: 'blocksBasic', keywords: ['paragraph', 'p', 'فقرة', 'نص'], run: (e, r) => turnInto(e, 'paragraph', r) },
  { id: 'h1', title: 'bH1', desc: 'bH1Desc', icon: Heading1, group: 'blocksBasic', keywords: ['h1', 'heading', 'title', 'عنوان', 'كبير'], hint: '#', run: (e, r) => turnInto(e, 'h1', r) },
  { id: 'h2', title: 'bH2', desc: 'bH2Desc', icon: Heading2, group: 'blocksBasic', keywords: ['h2', 'heading', 'subtitle', 'عنوان'], hint: '##', run: (e, r) => turnInto(e, 'h2', r) },
  { id: 'h3', title: 'bH3', desc: 'bH3Desc', icon: Heading3, group: 'blocksBasic', keywords: ['h3', 'heading', 'عنوان', 'صغير'], hint: '###', run: (e, r) => turnInto(e, 'h3', r) },
  { id: 'task', title: 'bTask', desc: 'bTaskDesc', icon: ListChecks, group: 'blocksBasic', keywords: ['todo', 'task', 'check', 'مهمة', 'مهام', 'واجب'], hint: '[]', run: (e, r) => turnInto(e, 'task', r) },
  { id: 'bullet', title: 'bBullet', desc: 'bBulletDesc', icon: List, group: 'blocksBasic', keywords: ['bullet', 'list', 'ul', 'قائمة', 'نقاط'], hint: '-', run: (e, r) => turnInto(e, 'bullet', r) },
  { id: 'ordered', title: 'bNumbered', desc: 'bNumberedDesc', icon: ListOrdered, group: 'blocksBasic', keywords: ['number', 'ordered', 'ol', 'ترقيم', 'أرقام'], hint: '1.', run: (e, r) => turnInto(e, 'ordered', r) },
  { id: 'toggle', title: 'bToggle', desc: 'bToggleDesc', icon: ListCollapse, group: 'blocksBasic', keywords: ['toggle', 'collapse', 'details', 'طي', 'إخفاء'], run: (e, r) => turnInto(e, 'toggle', r) },
  { id: 'quote', title: 'bQuote', desc: 'bQuoteDesc', icon: Quote, group: 'blocksBasic', keywords: ['quote', 'blockquote', 'اقتباس'], hint: '>', run: (e, r) => turnInto(e, 'quote', r) },
  { id: 'callout', title: 'bCallout', desc: 'bCalloutDesc', icon: Lightbulb, group: 'blocksBasic', keywords: ['callout', 'note', 'tip', 'ملاحظة', 'تنبيه', 'بارز'], run: (e, r) => turnInto(e, 'callout', r) },
  { id: 'divider', title: 'bDivider', desc: 'bDividerDesc', icon: Minus, group: 'blocksBasic', keywords: ['divider', 'hr', 'line', 'فاصل', 'خط'], hint: '---', run: (e, r) => insertDivider(e, r) },
  { id: 'code', title: 'bCode', desc: 'bCodeDesc', icon: Code2, group: 'blocksBasic', keywords: ['code', 'snippet', 'كود', 'برمجة'], hint: '```', run: (e, r) => turnInto(e, 'code', r) },
  { id: 'image', title: 'bImage', desc: 'bImageDesc', icon: ImageIcon, group: 'blocksMedia', keywords: ['image', 'photo', 'picture', 'صورة', 'صور'], run: (e, r) => void insertImage(e, r) },
  { id: 'page', title: 'bPage', desc: 'bPageDesc', icon: FileText, group: 'blocksData', keywords: ['page', 'subpage', 'صفحة', 'فرعية'], run: (e, r) => insertSubPage(e, r) },
  { id: 'linkpage', title: 'bLinkPage', desc: 'bLinkPageDesc', icon: Link2, group: 'blocksData', keywords: ['link', 'mention', 'رابط', 'إشارة'], run: (e, r) => insertPageMention(e, r) },
  { id: 'table', title: 'bTable', desc: 'bTableDesc', icon: Table2, group: 'blocksData', keywords: ['table', 'database', 'db', 'جدول', 'قاعدة', 'بيانات'], run: (e, r) => insertDatabase(e, 'table', r) },
  { id: 'board', title: 'bBoard', desc: 'bBoardDesc', icon: SquareKanban, group: 'blocksData', keywords: ['board', 'kanban', 'لوحة', 'كانبان', 'بطاقات'], run: (e, r) => insertDatabase(e, 'board', r) },
  { id: 'calendar', title: 'bCalendar', desc: 'bCalendarDesc', icon: CalendarDays, group: 'blocksData', keywords: ['calendar', 'تقويم', 'مواعيد', 'هجري'], run: (e, r) => insertDatabase(e, 'calendar', r) },
  { id: 'simpletable', title: 'bSimpleTable', desc: 'bSimpleTableDesc', icon: Grid3x3, group: 'blocksData', keywords: ['grid', 'simple table', 'جدول بسيط', 'شبكة'], run: (e, r) => insertSimpleTable(e, r) },
  { id: 'today', title: 'bToday', desc: 'bTodayDesc', icon: CalendarCheck2, group: 'blocksInsert', keywords: ['today', 'date', 'now', 'اليوم', 'تاريخ', 'هجري'], run: (e, r) => insertDate(e, r) },
  { id: 'date', title: 'bDate', desc: 'bDateDesc', icon: CalendarSearch, group: 'blocksInsert', keywords: ['date', 'pick', 'تاريخ', 'موعد'], run: (e, r) => insertDate(e, r, true) },
  { id: 'ai', title: 'bAi', desc: 'bAiDesc', icon: Sparkles, group: 'blocksAi', keywords: ['ai', 'assistant', 'claude', 'ذكاء', 'مساعد', 'اكتب'], run: (e, r) => openAi(e, { range: r }) },
  { id: 'voice', title: 'bVoice', desc: 'bVoiceDesc', icon: Mic, group: 'blocksAi', keywords: ['voice', 'speech', 'dictate', 'صوت', 'تسجيل', 'إملاء'], run: (e, r) => openVoice(e, r) },
]

export function filterSlashItems(query: string, _editor?: Editor): SlashItem[] {
  const q = query.trim()
  if (!q) return SLASH_ITEMS
  const scored = SLASH_ITEMS.map((it) => {
    const hay = [tIn('ar', it.title), tIn('en', it.title), ...it.keywords]
    const score = Math.max(...hay.map((h) => matchScore(h, q)))
    return { it, score }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.it)
}

export function groupLabel(g: SlashGroup) {
  return t(g)
}
