import { createDatabase, newView } from '../data/dbops'
import { useStore, ws } from '../data/store'
import type { PropDef, SelectOption, ViewDef } from '../data/types'
import { addDays, hijriToIso, todayIso, toHijri, weekday, formatGregorian, formatHijri, num } from '../lib/hijri'
import { getLang } from '../lib/i18n'
import { toLatinDigits } from '../lib/arabic'
import { uid } from '../lib/ids'
import { b, bullets, callout, date, dbBlock, doc, h2, h3, hl, numbered, p, quote, setPageContent, table, tasks, toggle } from './build'

const L = (ar: string, en: string) => (getLang() === 'ar' ? ar : en)
const N = (n: number) => num(n, useStore.getState().settings.numerals)

export interface Template {
  id: string
  icon: string
  name: () => string
  desc: () => string
  create: () => Promise<string>
}

const opt = (name: string, color: SelectOption['color'], group?: SelectOption['group']): SelectOption => ({ id: uid(6), name, color, ...(group ? { group } : {}) })
const fmt = () => ({ lang: getLang(), numerals: useStore.getState().settings.numerals })

function views(...vs: ViewDef[]) {
  return vs
}

// ---------------------------------------------------------------- Ramadan
async function ramadan(): Promise<string> {
  const w = ws()
  const h = toHijri(todayIso())
  const year = h.month <= 9 ? h.year : h.year + 1
  const rootId = w.createPage({ title: L(`مخطط رمضان ${N(year)}`, `Ramadan planner ${year}`), icon: '🌙', cover: { kind: 'pattern', value: 'khatam' } })
  const fast = uid(6), taraweeh = uid(6), quran = uid(6), charity = uid(6), dateId = uid(6), notes = uid(6)
  const schema: PropDef[] = [
    { id: 'title', name: L('اليوم', 'Day'), type: 'title' },
    { id: dateId, name: L('التاريخ', 'Date'), type: 'date' },
    { id: fast, name: L('صيام', 'Fasting'), type: 'checkbox' },
    { id: taraweeh, name: L('تراويح', 'Taraweeh'), type: 'checkbox' },
    { id: quran, name: L('ورد القرآن', 'Quran portion'), type: 'checkbox' },
    { id: charity, name: L('صدقة', 'Charity'), type: 'checkbox' },
    { id: notes, name: L('ملاحظات', 'Notes'), type: 'text' },
  ]
  const table1 = newView('table', schema, L('الأيام', 'Days'))
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: dateId, calendar: 'hijri' as const }
  const dbId = createDatabase(w, { parentId: rootId, inline: true, title: L('أيام الشهر', 'Days of the month'), schema, views: views(table1, cal) })
  const start = hijriToIso(year, 9, 1)
  for (let d = 0; d < 30; d++) {
    const iso = addDays(start, d)
    if (toHijri(iso).month !== 9) break
    w.createPage({ type: 'row', parentId: dbId, title: L(`اليوم ${N(d + 1)}`, `Day ${d + 1}`), props: { [dateId]: iso } })
  }
  await setPageContent(
    rootId,
    doc(
      callout('🌙', 'blue', p(L('رمضان فرصة لا تتكرر إلا مرة في العام. دوّن نيّتك وأهدافك، وتابع يومك بهدوء.', 'Ramadan comes once a year. Write your intentions and goals, and follow your days calmly.'))),
      h2(L('أهدافي في رمضان', 'My goals this Ramadan')),
      tasks(
        L('ختم القرآن مرة على الأقل', 'Finish the Quran at least once'),
        L('صلاة التراويح كاملة', 'Pray taraweeh every night'),
        L('صدقة يومية ولو قليلة', 'Give charity every day, even a little'),
        L('صلة الرحم وزيارة الأهل', 'Visit and call family'),
        L('قيام العشر الأواخر', 'Pray at night in the last ten'),
      ),
      h2(L('أيام الشهر', 'Days of the month')),
      dbBlock(dbId),
      h2(L('أفكار للإفطار والسحور', 'Iftar & suhoor ideas')),
      bullets(L('شوربة عدس', 'Lentil soup'), L('سمبوسة وفطائر', 'Sambusa and pastries'), L('سلطة فتوش', 'Fattoush salad'), L('تمر ولبن', 'Dates and laban')),
      h2(L('العشر الأواخر', 'The last ten nights')),
      toggle(L('خطة الليالي العشر', 'Plan for the ten nights'), tasks(L('دعاء ليلة القدر', 'Laylat al-Qadr supplication'), L('اعتكاف ولو ساعة', 'Spend time in i‘tikaf'), L('زكاة الفطر قبل العيد', 'Pay zakat al-fitr before Eid'))),
      p(),
    ),
  )
  return rootId
}

// ---------------------------------------------------------------- Khatma
const JUZ_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون', 'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون', 'الرابع والعشرون', 'الخامس والعشرون', 'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون', 'التاسع والعشرون', 'الثلاثون']
const JUZ_RANGE = [
  'الفاتحة ١ – البقرة ١٤١', 'البقرة ١٤٢ – ٢٥٢', 'البقرة ٢٥٣ – آل عمران ٩٢', 'آل عمران ٩٣ – النساء ٢٣', 'النساء ٢٤ – ١٤٧', 'النساء ١٤٨ – المائدة ٨١',
  'المائدة ٨٢ – الأنعام ١١٠', 'الأنعام ١١١ – الأعراف ٨٧', 'الأعراف ٨٨ – الأنفال ٤٠', 'الأنفال ٤١ – التوبة ٩٢', 'التوبة ٩٣ – هود ٥', 'هود ٦ – يوسف ٥٢',
  'يوسف ٥٣ – إبراهيم ٥٢', 'الحجر ١ – النحل ١٢٨', 'الإسراء ١ – الكهف ٧٤', 'الكهف ٧٥ – طه ١٣٥', 'الأنبياء ١ – الحج ٧٨', 'المؤمنون ١ – الفرقان ٢٠',
  'الفرقان ٢١ – النمل ٥٥', 'النمل ٥٦ – العنكبوت ٤٥', 'العنكبوت ٤٦ – الأحزاب ٣٠', 'الأحزاب ٣١ – يس ٢٧', 'يس ٢٨ – الزمر ٣١', 'الزمر ٣٢ – فصلت ٤٦',
  'فصلت ٤٧ – الجاثية ٣٧', 'الأحقاف ١ – الذاريات ٣٠', 'الذاريات ٣١ – الحديد ٢٩', 'المجادلة ١ – التحريم ١٢', 'الملك ١ – المرسلات ٥٠', 'النبأ ١ – الناس ٦',
]

async function khatma(): Promise<string> {
  const w = ws()
  const status = uid(6), dateId = uid(6), range = uid(6), notes = uid(6)
  const opts = [opt(L('لم أبدأ', 'Not started'), 'gray', 'todo'), opt(L('أقرأ', 'Reading'), 'blue', 'doing'), opt(L('أتممت', 'Done'), 'green', 'done')]
  const schema: PropDef[] = [
    { id: 'title', name: L('الجزء', 'Juz'), type: 'title' },
    { id: status, name: L('الحالة', 'Status'), type: 'status', options: opts },
    { id: range, name: L('من – إلى', 'From – to'), type: 'text' },
    { id: dateId, name: L('تاريخ الإتمام', 'Finished on'), type: 'date' },
    { id: notes, name: L('ملاحظات', 'Notes'), type: 'text' },
  ]
  const board = { ...newView('board', schema, L('اللوحة', 'Board')), groupBy: status, hidden: [range, notes] }
  const dbId = createDatabase(w, { parentId: null, inline: false, title: L('ختمة القرآن', 'Quran khatma'), icon: '📖', schema, views: views(newView('table', schema, L('الأجزاء', 'Juz list')), board) })
  for (let j = 0; j < 30; j++) {
    const rangeText = useStore.getState().settings.numerals === 'latn' ? toLatinDigits(JUZ_RANGE[j]) : JUZ_RANGE[j]
    w.createPage({ type: 'row', parentId: dbId, title: L(`الجزء ${JUZ_AR[j]}`, `Juz ${j + 1}`), props: { [status]: opts[0].id, [range]: rangeText } })
  }
  return dbId
}

// ---------------------------------------------------------------- Projects
async function projects(): Promise<string> {
  const w = ws()
  const rootId = w.createPage({ title: L('إدارة المشاريع', 'Project management'), icon: '🚀', cover: { kind: 'pattern', value: 'arches' } })
  const status = uid(6), prio = uid(6), owner = uid(6), due = uid(6), proj = uid(6)
  const st = [opt(L('للعمل', 'To do'), 'gray', 'todo'), opt(L('جارٍ', 'In progress'), 'blue', 'doing'), opt(L('مراجعة', 'Review'), 'purple', 'doing'), opt(L('منجز', 'Done'), 'green', 'done')]
  const pr = [opt(L('عالية', 'High'), 'red'), opt(L('متوسطة', 'Medium'), 'orange'), opt(L('منخفضة', 'Low'), 'gray')]
  const people = [opt(L('نورة', 'Noura'), 'pink'), opt(L('فهد', 'Fahad'), 'blue'), opt(L('مريم', 'Maryam'), 'green')]
  const pj = [opt(L('الموقع', 'Website'), 'blue'), opt(L('التطبيق', 'App'), 'purple'), opt(L('التسويق', 'Marketing'), 'orange')]
  const schema: PropDef[] = [
    { id: 'title', name: L('المهمة', 'Task'), type: 'title' },
    { id: status, name: L('الحالة', 'Status'), type: 'status', options: st },
    { id: prio, name: L('الأولوية', 'Priority'), type: 'select', options: pr },
    { id: owner, name: L('المسؤول', 'Assignee'), type: 'person', options: people },
    { id: due, name: L('الموعد', 'Due'), type: 'date' },
    { id: proj, name: L('المشروع', 'Project'), type: 'select', options: pj },
  ]
  const board = { ...newView('board', schema, L('اللوحة', 'Board')), groupBy: status }
  const tableV = { ...newView('table', schema, L('كل المهام', 'All tasks')), sorts: [{ propId: due, dir: 'asc' as const }] }
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: due }
  const dbId = createDatabase(w, { parentId: rootId, inline: true, title: L('مهام الفريق', 'Team tasks'), schema, views: views(board, tableV, cal) })
  const t0 = todayIso()
  const rows: [string, number, number, number, number, number][] = [
    [L('تصميم الصفحة الرئيسية', 'Design the home page'), 1, 0, 0, 2, 0],
    [L('كتابة نصوص الإطلاق', 'Write launch copy'), 0, 1, 2, 5, 2],
    [L('اختبار نسخة الأندرويد', 'Test the Android build'), 2, 0, 1, 1, 1],
    [L('إعداد عرض العميل', 'Prepare the client demo'), 1, 0, 2, 3, 0],
    [L('مراجعة الميزانية', 'Review the budget'), 0, 2, 0, 7, 2],
    [L('إطلاق النسخة الأولى', 'Ship version one'), 0, 0, 1, 9, 1],
    [L('تحديث المستثمرين', 'Investor update'), 3, 1, 0, -2, 2],
  ]
  rows.forEach(([title, s, pri, o, d, pjI]) =>
    w.createPage({ type: 'row', parentId: dbId, title, props: { [status]: st[s].id, [prio]: pr[pri].id, [owner]: [people[o].id], [due]: addDays(t0, d), [proj]: pj[pjI].id } }),
  )
  await setPageContent(
    rootId,
    doc(
      callout('🧭', 'gray', p(L('اسحب البطاقات بين الأعمدة لتغيير حالتها، وبدّل إلى الجدول أو التقويم من أعلى القائمة.', 'Drag cards between columns to change their status, and switch to the table or calendar from the tabs.'))),
      dbBlock(dbId),
      h2(L('ملاحظات الأسبوع', 'Notes this week')),
      bullets(L('أهم ما أُنجز', 'What we shipped'), L('ما يعيقنا', 'What’s blocking us'), L('قرارات تحتاج نقاشاً', 'Decisions to discuss')),
      p(),
    ),
  )
  return rootId
}

// ---------------------------------------------------------------- Lecture notes
async function lecture(): Promise<string> {
  const w = ws()
  const id = w.createPage({ title: L('ملاحظات محاضرة', 'Lecture notes'), icon: '🎓' })
  await setPageContent(
    id,
    doc(
      callout('📌', 'blue', p(b(L('المادة: ', 'Course: ')), L('……', '……')), p(b(L('الأستاذ: ', 'Lecturer: ')), L('……', '……')), p(b(L('التاريخ: ', 'Date: ')), date(todayIso()))),
      h2(L('الأفكار الرئيسية', 'Key ideas')),
      bullets(L('الفكرة الأولى', 'First idea'), L('الفكرة الثانية', 'Second idea'), L('الفكرة الثالثة', 'Third idea')),
      h2(L('المصطلحات', 'Terms')),
      table([
        [L('المصطلح', 'Term'), L('معناه', 'Meaning')],
        ['', ''],
        ['', ''],
      ]),
      h2(L('اقتباس مهم', 'Key quote')),
      quote(p(L('اكتب هنا عبارة قالها المحاضر وتريد تذكّرها.', 'A sentence from the lecture you want to remember.'))),
      h2(L('أسئلة للمراجعة', 'Review questions')),
      tasks(L('سؤال للمراجعة قبل الاختبار', 'A question to review before the exam'), L('نقطة أحتاج أن أسأل عنها', 'Something to ask about')),
      h2(L('الخلاصة', 'Summary')),
      p(L('لخّص المحاضرة في ثلاثة أسطر.', 'Summarize the lecture in three lines.')),
    ),
  )
  return id
}

// ---------------------------------------------------------------- Homework
async function homework(): Promise<string> {
  const w = ws()
  const subject = uid(6), due = uid(6), status = uid(6), prio = uid(6)
  const subs = [opt(L('رياضيات', 'Math'), 'blue'), opt(L('علوم', 'Science'), 'green'), opt(L('لغة عربية', 'Arabic'), 'brown'), opt(L('إنجليزي', 'English'), 'purple')]
  const st = [opt(L('لم يبدأ', 'Not started'), 'gray', 'todo'), opt(L('جارٍ', 'In progress'), 'blue', 'doing'), opt(L('سُلّم', 'Submitted'), 'green', 'done')]
  const pr = [opt(L('عاجل', 'Urgent'), 'red'), opt(L('عادي', 'Normal'), 'gray')]
  const schema: PropDef[] = [
    { id: 'title', name: L('الواجب', 'Assignment'), type: 'title' },
    { id: subject, name: L('المادة', 'Subject'), type: 'select', options: subs },
    { id: due, name: L('الموعد', 'Due'), type: 'date' },
    { id: status, name: L('الحالة', 'Status'), type: 'status', options: st },
    { id: prio, name: L('الأولوية', 'Priority'), type: 'select', options: pr },
  ]
  const tableV = { ...newView('table', schema, L('الواجبات', 'Assignments')), sorts: [{ propId: due, dir: 'asc' as const }] }
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: due }
  const board = { ...newView('board', schema, L('حسب الحالة', 'By status')), groupBy: status }
  const dbId = createDatabase(w, { parentId: null, inline: false, title: L('متابعة الواجبات', 'Homework tracker'), icon: '📚', schema, views: views(tableV, cal, board) })
  const t0 = todayIso()
  ;[
    [L('حل تمارين الفصل الثالث', 'Chapter 3 exercises'), 0, 2, 0, 1],
    [L('تقرير عن دورة الماء', 'Water cycle report'), 1, 5, 1, 1],
    [L('تعبير: يوم لا يُنسى', 'Essay: an unforgettable day'), 2, 3, 0, 0],
    [L('قراءة القصة وتلخيصها', 'Read and summarize the story'), 3, 7, 0, 1],
  ].forEach(([title, s, d, stt, pp]) =>
    w.createPage({ type: 'row', parentId: dbId, title: title as string, props: { [subject]: subs[s as number].id, [due]: addDays(t0, d as number), [status]: st[stt as number].id, [prio]: pr[pp as number].id } }),
  )
  return dbId
}

// ---------------------------------------------------------------- Meeting
async function meeting(): Promise<string> {
  const w = ws()
  const id = w.createPage({ title: L('محضر اجتماع', 'Meeting minutes'), icon: '🗓️' })
  await setPageContent(
    id,
    doc(
      p(b(L('التاريخ: ', 'Date: ')), date(todayIso())),
      p(b(L('المكان: ', 'Location: ')), L('قاعة الاجتماعات', 'Meeting room')),
      h2(L('الحضور', 'Attendees')),
      bullets(L('الاسم', 'Name'), L('الاسم', 'Name')),
      h2(L('جدول الأعمال', 'Agenda')),
      numbered(L('مراجعة ما أُنجز منذ الاجتماع السابق', 'Review progress since last meeting'), L('البند الرئيسي', 'Main topic'), L('ما يُستجد من أعمال', 'Any other business')),
      h2(L('النقاش', 'Discussion')),
      p(L('أهم ما قيل في كل بند.', 'The key points under each item.')),
      callout('✅', 'green', p(b(L('القرارات', 'Decisions'))), bullets(L('القرار الأول', 'First decision'), L('القرار الثاني', 'Second decision'))),
      h2(L('المهام التالية', 'Next steps')),
      tasks([L('المهمة', 'Task') + ' (', b(L('المسؤول', 'Owner')), ')'], [L('المهمة', 'Task') + ' (', b(L('المسؤول', 'Owner')), ')']),
      h2(L('الاجتماع القادم', 'Next meeting')),
      p(date(addDays(todayIso(), 7))),
    ),
  )
  return id
}

// ---------------------------------------------------------------- Budget
async function budget(): Promise<string> {
  const w = ws()
  const rootId = w.createPage({ title: L('الميزانية الشهرية', 'Monthly budget'), icon: '💰', cover: { kind: 'color', value: 'oasis' } })
  const amountI = uid(6), dateI = uid(6)
  const incomeSchema: PropDef[] = [
    { id: 'title', name: L('المصدر', 'Source'), type: 'title' },
    { id: amountI, name: L('المبلغ', 'Amount'), type: 'number', numberFormat: 'comma' },
    { id: dateI, name: L('التاريخ', 'Date'), type: 'date' },
  ]
  const incomeId = createDatabase(w, { parentId: rootId, inline: true, title: L('الدخل', 'Income'), schema: incomeSchema, views: views(newView('table', incomeSchema, L('الدخل', 'Income'))) })
  const t0 = todayIso()
  w.createPage({ type: 'row', parentId: incomeId, title: L('الراتب', 'Salary'), props: { [amountI]: 1200, [dateI]: t0 } })
  w.createPage({ type: 'row', parentId: incomeId, title: L('دخل إضافي', 'Side income'), props: { [amountI]: 150 } })

  const cat = uid(6), amount = uid(6), dateE = uid(6), pay = uid(6)
  const cats = [opt(L('سكن', 'Housing'), 'brown'), opt(L('طعام', 'Food'), 'orange'), opt(L('مواصلات', 'Transport'), 'blue'), opt(L('فواتير', 'Bills'), 'purple'), opt(L('ترفيه', 'Fun'), 'pink'), opt(L('صحة', 'Health'), 'green'), opt(L('أخرى', 'Other'), 'gray')]
  const pays = [opt(L('نقداً', 'Cash'), 'green'), opt(L('بطاقة', 'Card'), 'blue'), opt(L('تحويل', 'Transfer'), 'purple')]
  const expSchema: PropDef[] = [
    { id: 'title', name: L('البند', 'Item'), type: 'title' },
    { id: cat, name: L('الفئة', 'Category'), type: 'select', options: cats },
    { id: amount, name: L('المبلغ', 'Amount'), type: 'number', numberFormat: 'comma' },
    { id: dateE, name: L('التاريخ', 'Date'), type: 'date' },
    { id: pay, name: L('طريقة الدفع', 'Paid with'), type: 'select', options: pays },
  ]
  const expId = createDatabase(w, { parentId: rootId, inline: true, title: L('المصروفات', 'Expenses'), schema: expSchema, views: views(newView('table', expSchema, L('كل المصروفات', 'All expenses')), { ...newView('board', expSchema, L('حسب الفئة', 'By category')), groupBy: cat }) })
  ;[
    [L('إيجار', 'Rent'), 0, 400, 1],
    [L('مقاضي البيت', 'Groceries'), 1, 85, 1],
    [L('بنزين', 'Fuel'), 2, 20, 0],
    [L('فاتورة الهاتف', 'Phone bill'), 3, 15, 2],
    [L('عشاء مع العائلة', 'Family dinner'), 4, 30, 1],
  ].forEach(([title, c, a, pm], k) =>
    w.createPage({ type: 'row', parentId: expId, title: title as string, props: { [cat]: cats[c as number].id, [amount]: a as number, [dateE]: addDays(t0, -k * 3), [pay]: pays[pm as number].id } }),
  )
  await setPageContent(
    rootId,
    doc(
      callout('💡', 'yellow', p(L('سجّل كل مصروف يوم صرفه، وتظهر المجاميع أسفل كل جدول تلقائياً.', 'Log each expense the day you spend it. Totals appear under each table automatically.'))),
      h2(L('الدخل', 'Income')),
      dbBlock(incomeId),
      h2(L('المصروفات', 'Expenses')),
      dbBlock(expId),
      h2(L('أهداف الادخار', 'Savings goals')),
      tasks(L('ادخار ١٠٪ من الدخل', 'Save 10% of income'), L('صندوق للطوارئ', 'Emergency fund'), L('هدف خاص: سفر أو تعليم', 'A personal goal: travel or study')),
      p(),
    ),
  )
  return rootId
}

// ---------------------------------------------------------------- Travel
async function travel(): Promise<string> {
  const w = ws()
  const rootId = w.createPage({ title: L('خطة سفر', 'Travel plan'), icon: '✈️', cover: { kind: 'pattern', value: 'dunes' } })
  const dayI = uid(6), place = uid(6), status = uid(6)
  const st = [opt(L('مخطط', 'Planned'), 'gray', 'todo'), opt(L('محجوز', 'Booked'), 'blue', 'doing'), opt(L('تم', 'Done'), 'green', 'done')]
  const schema: PropDef[] = [
    { id: 'title', name: L('النشاط', 'Activity'), type: 'title' },
    { id: dayI, name: L('اليوم', 'Day'), type: 'date' },
    { id: place, name: L('المكان', 'Place'), type: 'text' },
    { id: status, name: L('الحالة', 'Status'), type: 'status', options: st },
  ]
  const tableV = { ...newView('table', schema, L('البرنامج', 'Itinerary')), sorts: [{ propId: dayI, dir: 'asc' as const }] }
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: dayI }
  const dbId = createDatabase(w, { parentId: rootId, inline: true, title: L('البرنامج اليومي', 'Day by day'), schema, views: views(tableV, cal) })
  const s = addDays(todayIso(), 14)
  ;[
    [L('الوصول وتسجيل الدخول في الفندق', 'Arrive and check in'), 0, 1],
    [L('جولة في المدينة القديمة', 'Old town walk'), 1, 0],
    [L('رحلة يوم كامل', 'Day trip'), 2, 1],
    [L('التسوق والعودة', 'Shopping and flight home'), 3, 0],
  ].forEach(([title, d, stt]) => w.createPage({ type: 'row', parentId: dbId, title: title as string, props: { [dayI]: addDays(s, d as number), [status]: st[stt as number].id } }))
  await setPageContent(
    rootId,
    doc(
      callout('🧳', 'blue', p(b(L('الوجهة: ', 'Destination: ')), L('……', '……')), p(b(L('من: ', 'From: ')), date(s), L('  إلى: ', '  to: '), date(addDays(s, 4)))),
      h2(L('قائمة التجهيز', 'Packing list')),
      tasks(L('جواز السفر', 'Passport'), L('التأشيرة', 'Visa'), L('تأمين السفر', 'Travel insurance'), L('الشاحن ومحوّل الكهرباء', 'Charger and plug adapter'), L('الأدوية', 'Medicines')),
      h2(L('البرنامج اليومي', 'Day by day')),
      dbBlock(dbId),
      h2(L('الحجوزات', 'Bookings')),
      table([
        [L('النوع', 'Type'), L('التفاصيل', 'Details'), L('رقم الحجز', 'Reference')],
        [L('طيران', 'Flight'), '', ''],
        [L('فندق', 'Hotel'), '', ''],
      ]),
      h2(L('الميزانية', 'Budget')),
      bullets(L('التذاكر', 'Tickets'), L('السكن', 'Stay'), L('الطعام والتنقل', 'Food and transport')),
      p(),
    ),
  )
  return rootId
}

// ---------------------------------------------------------------- Reading list
async function reading(): Promise<string> {
  const w = ws()
  const author = uid(6), status = uid(6), rating = uid(6), genre = uid(6), done = uid(6)
  const st = [opt(L('أريد قراءته', 'Want to read'), 'gray', 'todo'), opt(L('أقرؤه', 'Reading'), 'blue', 'doing'), opt(L('أنهيته', 'Finished'), 'green', 'done')]
  const rt = [opt('⭐', 'yellow'), opt('⭐⭐', 'yellow'), opt('⭐⭐⭐', 'yellow'), opt('⭐⭐⭐⭐', 'yellow'), opt('⭐⭐⭐⭐⭐', 'yellow')]
  const gn = [opt(L('فكر', 'Ideas'), 'purple'), opt(L('أدب', 'Literature'), 'pink'), opt(L('تاريخ', 'History'), 'brown'), opt(L('تطوير ذات', 'Self-growth'), 'green'), opt(L('دين', 'Faith'), 'blue')]
  const schema: PropDef[] = [
    { id: 'title', name: L('الكتاب', 'Book'), type: 'title' },
    { id: author, name: L('المؤلف', 'Author'), type: 'text' },
    { id: status, name: L('الحالة', 'Status'), type: 'status', options: st },
    { id: rating, name: L('التقييم', 'Rating'), type: 'select', options: rt },
    { id: genre, name: L('التصنيف', 'Genre'), type: 'multi_select', options: gn },
    { id: done, name: L('تاريخ الإنهاء', 'Finished on'), type: 'date' },
  ]
  const board = { ...newView('board', schema, L('اللوحة', 'Board')), groupBy: status }
  const dbId = createDatabase(w, { parentId: null, inline: false, title: L('قائمة القراءة', 'Reading list'), icon: '📚', schema, views: views(board, newView('table', schema, L('الجدول', 'Table'))) })
  ;[
    [L('المقدمة', 'The Muqaddimah'), L('ابن خلدون', 'Ibn Khaldun'), 1, [0, 2]],
    [L('كليلة ودمنة', 'Kalila wa Dimna'), L('ابن المقفع', 'Ibn al-Muqaffa'), 2, [1]],
    [L('الأيام', 'The Days'), L('طه حسين', 'Taha Hussein'), 0, [1]],
    [L('رسالة الغفران', 'The Epistle of Forgiveness'), L('أبو العلاء المعري', 'Al-Maʿarri'), 0, [1]],
  ].forEach(([title, a, s, g]) =>
    w.createPage({ type: 'row', parentId: dbId, title: title as string, props: { [author]: a as string, [status]: st[s as number].id, [genre]: (g as number[]).map((k) => gn[k].id) } }),
  )
  return dbId
}

// ---------------------------------------------------------------- Habits
async function habits(): Promise<string> {
  const w = ws()
  const dateI = uid(6)
  const habitsList: [string, string][] = [
    [L('رياضة', 'Exercise'), uid(6)],
    [L('قراءة', 'Reading'), uid(6)],
    [L('ماء ٨ أكواب', '8 glasses of water'), uid(6)],
    [L('أذكار الصباح والمساء', 'Morning & evening adhkar'), uid(6)],
    [L('نوم مبكر', 'Early sleep'), uid(6)],
  ]
  const notes = uid(6)
  const schema: PropDef[] = [
    { id: 'title', name: L('اليوم', 'Day'), type: 'title' },
    { id: dateI, name: L('التاريخ', 'Date'), type: 'date' },
    ...habitsList.map(([name, id]) => ({ id, name, type: 'checkbox' as const })),
    { id: notes, name: L('ملاحظات', 'Notes'), type: 'text' },
  ]
  const tableV = { ...newView('table', schema, L('الأيام', 'Days')), sorts: [{ propId: dateI, dir: 'asc' as const }] }
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: dateI }
  const dbId = createDatabase(w, { parentId: null, inline: false, title: L('متتبع العادات', 'Habit tracker'), icon: '🔥', schema, views: views(tableV, cal) })
  const t0 = todayIso()
  for (let d = 0; d < 7; d++) {
    const iso = addDays(t0, d)
    const title = getLang() === 'ar' ? formatHijri(iso, { ...fmt(), weekday: true, year: false }) : formatGregorian(iso, { ...fmt(), weekday: true, year: false })
    w.createPage({ type: 'row', parentId: dbId, title, props: { [dateI]: iso } })
  }
  return dbId
}

// ---------------------------------------------------------------- Journal
async function journal(): Promise<string> {
  const w = ws()
  const dateI = uid(6), mood = uid(6), tags = uid(6)
  const moods = [opt(L('😊 سعيد', '😊 Happy'), 'green'), opt(L('😌 هادئ', '😌 Calm'), 'blue'), opt(L('😐 عادي', '😐 Okay'), 'gray'), opt(L('😔 حزين', '😔 Sad'), 'purple'), opt(L('😤 متوتر', '😤 Stressed'), 'orange')]
  const tg = [opt(L('عائلة', 'Family'), 'pink'), opt(L('عمل', 'Work'), 'blue'), opt(L('امتنان', 'Gratitude'), 'yellow')]
  const schema: PropDef[] = [
    { id: 'title', name: L('العنوان', 'Title'), type: 'title' },
    { id: dateI, name: L('التاريخ', 'Date'), type: 'date' },
    { id: mood, name: L('المزاج', 'Mood'), type: 'select', options: moods },
    { id: tags, name: L('الوسوم', 'Tags'), type: 'multi_select', options: tg },
  ]
  const cal = { ...newView('calendar', schema, L('التقويم', 'Calendar')), datePropId: dateI }
  const tableV = { ...newView('table', schema, L('كل الأيام', 'All entries')), sorts: [{ propId: dateI, dir: 'desc' as const }] }
  const dbId = createDatabase(w, { parentId: null, inline: false, title: L('يومياتي', 'My journal'), icon: '✍️', schema, views: views(cal, tableV) })
  const rowId = w.createPage({ type: 'row', parentId: dbId, title: L('يوم جديد', 'A new day'), props: { [dateI]: todayIso(), [mood]: moods[1].id, [tags]: [tg[2].id] } })
  await setPageContent(
    rowId,
    doc(
      h3(L('ما الذي أنا ممتن له اليوم؟', 'What am I grateful for today?')),
      bullets(''),
      h3(L('أبرز ما حدث', 'Highlights')),
      p(),
      h3(L('ما الذي تعلمته؟', 'What did I learn?')),
      p(),
      h3(L('غداً سأحاول', 'Tomorrow I will try')),
      tasks(''),
    ),
  )
  return dbId
}

// ---------------------------------------------------------------- Weekly plan
async function weekly(): Promise<string> {
  const w = ws()
  const t0 = todayIso()
  const sunday = addDays(t0, -weekday(t0))
  const id = w.createPage({ title: L('تخطيط الأسبوع', 'Weekly plan'), icon: '🗂️' })
  const days = getLang() === 'ar' ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const blocks = days.flatMap((d, k) => [h3(d, '  ', date(addDays(sunday, k))), tasks('')])
  await setPageContent(
    id,
    doc(
      p(L('الأسبوع من ', 'Week of '), date(sunday), L(' إلى ', ' to '), date(addDays(sunday, 6))),
      callout('🎯', 'orange', p(b(L('أهم ثلاثة أهداف هذا الأسبوع', 'Top three goals this week'))), numbered('', '', '')),
      ...blocks,
      h2(L('ملاحظات', 'Notes')),
      p(hl(L('ما الذي سأفعله بشكل مختلف الأسبوع القادم؟', 'What will I do differently next week?'))),
    ),
  )
  return id
}

export const TEMPLATES: Template[] = [
  { id: 'ramadan', icon: '🌙', name: () => L('مخطط رمضان', 'Ramadan planner'), desc: () => L('أهداف الشهر، ومتابعة يومية للصيام والتراويح والورد، بالتقويم الهجري', 'Goals and a daily tracker for fasting, taraweeh and Quran, on the Hijri calendar'), create: ramadan },
  { id: 'khatma', icon: '📖', name: () => L('ختمة القرآن', 'Quran khatma'), desc: () => L('الأجزاء الثلاثون بحدودها، وحالة كل جزء وتاريخ إتمامه', 'All thirty juz with their ranges, status and finish date'), create: khatma },
  { id: 'projects', icon: '🚀', name: () => L('إدارة مشاريع', 'Project management'), desc: () => L('لوحة مهام للفريق بالحالة والأولوية والمسؤول والموعد', 'A team board with status, priority, owner and due date'), create: projects },
  { id: 'lecture', icon: '🎓', name: () => L('ملاحظات محاضرة', 'Lecture notes'), desc: () => L('أفكار رئيسية، ومصطلحات، وأسئلة للمراجعة', 'Key ideas, terms and review questions'), create: lecture },
  { id: 'homework', icon: '📚', name: () => L('متابعة الواجبات', 'Homework tracker'), desc: () => L('كل الواجبات بمواعيدها في جدول وتقويم', 'Every assignment with its due date, as a table and calendar'), create: homework },
  { id: 'meeting', icon: '🗓️', name: () => L('محضر اجتماع', 'Meeting minutes'), desc: () => L('الحضور وجدول الأعمال والقرارات والمهام التالية', 'Attendees, agenda, decisions and next steps'), create: meeting },
  { id: 'budget', icon: '💰', name: () => L('الميزانية الشهرية', 'Monthly budget'), desc: () => L('الدخل والمصروفات بالفئات، مع المجاميع تلقائياً', 'Income and expenses by category, totals included'), create: budget },
  { id: 'travel', icon: '✈️', name: () => L('خطة سفر', 'Travel plan'), desc: () => L('قائمة التجهيز، والبرنامج اليومي، والحجوزات', 'Packing list, day-by-day plan and bookings'), create: travel },
  { id: 'reading', icon: '📚', name: () => L('قائمة القراءة', 'Reading list'), desc: () => L('كتبك مرتبة حسب الحالة، مع التقييم والتصنيف', 'Your books by status, with rating and genre'), create: reading },
  { id: 'habits', icon: '🔥', name: () => L('متتبع العادات', 'Habit tracker'), desc: () => L('عاداتك اليومية بمربعات اختيار لكل يوم', 'Daily habits with a checkbox for each day'), create: habits },
  { id: 'journal', icon: '✍️', name: () => L('يومياتي', 'My journal'), desc: () => L('صفحة لكل يوم، مع المزاج والوسوم والتقويم', 'A page per day with mood, tags and a calendar'), create: journal },
  { id: 'weekly', icon: '🗂️', name: () => L('تخطيط الأسبوع', 'Weekly plan'), desc: () => L('أهم أهداف الأسبوع ومهام كل يوم من الأحد إلى السبت', 'Top goals and daily tasks from Sunday to Saturday'), create: weekly },
]
