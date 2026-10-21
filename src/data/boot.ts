import { installMarkdownHooks } from '../lib/exporter'
import { setLang, t } from '../lib/i18n'
import { todayIso } from '../lib/hijri'
import { b, callout, code, date, doc, h2, p, pageLink, setPageContent, tasks } from '../templates/build'
import { setSyncHook } from './docs'
import { kvGet, kvSet, outboxAdd } from './idb'
import { initRouter, navigate, takePendingAction } from './nav'
import { useStore, type Settings } from './store'
import { getActor, setActor, Workspace } from './workspace'

function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return theme
}

export function applyAppearance(s: Settings) {
  const html = document.documentElement
  html.lang = s.lang
  html.dir = s.lang === 'ar' ? 'rtl' : 'ltr'
  const theme = resolveTheme(s.theme)
  html.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14171f' : '#f4f5f2')
  document.title = t('appName')
  window.dispatchEvent(new CustomEvent('qirtas:appearance', { detail: { theme } }))
}

async function seedWelcome(w: Workspace) {
  const L = (ar: string, en: string) => (useStore.getState().settings.lang === 'ar' ? ar : en)
  const welcome = w.createPage({ title: L('أهلاً بك في قِرطاس', 'Welcome to Qirtas'), icon: '✍️', cover: { kind: 'pattern', value: 'ruled' } })
  const child = w.createPage({ title: L('صفحة داخلية', 'A page inside a page'), icon: '📄', parentId: welcome })
  await setPageContent(
    child,
    doc(p(L('الصفحات تتداخل بلا حدود. أضف صفحة داخل أي صفحة من زر + في الشريط الجانبي، أو بكتابة /صفحة.', 'Pages nest without limits. Add one from the + in the sidebar, or type /page.'))),
  )
  await setPageContent(
    welcome,
    doc(
      callout('📜', 'blue', p(L('قِرطاس مساحتك للملاحظات والمهام والمشاريع، بالعربية أولاً. كل ما تكتبه محفوظ على جهازك ويعمل دون اتصال.', 'Qirtas is your space for notes, tasks and projects, Arabic first. Everything is saved on your device and works offline.'))),
      h2(L('ابدأ من هنا', 'Start here')),
      tasks(
        [L('اكتب ', 'Type '), code('/'), L(' في سطر جديد لترى كل أنواع الكتل', ' on a new line to see every block type')],
        [L('اكتب ', 'Type '), code('#'), L(' ثم مسافة لعنوان، و', ' and a space for a heading, '), code('-'), L(' لقائمة، و', ' for a list, '), code('[]'), L(' لمهمة', ' for a task')],
        [L('حدّد أي نص لتنسيقه أو تلوينه أو لطلب ', 'Select any text to format it, color it or ask the '), b(L('المساعد', 'assistant'))],
        [L('اسحب المقبض بجانب أي سطر لتغيير ترتيبه', 'Drag the handle beside any line to move it')],
        [L('جرّب البحث: اكتب «القران» وسيجد «القرآن»', 'Try search: “القران” finds “القرآن”')],
      ),
      h2(L('التاريخ الهجري', 'Hijri dates')),
      p(L('اليوم: ', 'Today: '), date(todayIso())),
      p(L('أدرج التاريخ في أي صفحة بكتابة /تاريخ، واعرض قواعد البيانات في تقويم هجري أو ميلادي.', 'Insert a date anywhere with /date, and show databases on a Hijri or Gregorian calendar.')),
      h2(L('العربية والإنجليزية معاً', 'Arabic and English together')),
      p(L('كل سطر يأخذ اتجاهه من أول حرف فيه:', 'Each line takes its direction from its first letter:')),
      p('Meeting with the design team at 10am'),
      p(L('اجتماع مع فريق التصميم الساعة العاشرة', 'اجتماع مع فريق التصميم الساعة العاشرة')),
      h2(L('صفحات داخل صفحات', 'Pages inside pages')),
      pageLink(child),
      p(),
    ),
  )
  w.markSeeded([welcome, child])
  return welcome
}

export async function boot() {
  const store = useStore.getState()
  setLang(store.settings.lang)
  applyAppearance(store.settings)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(useStore.getState().settings))
  useStore.subscribe((s, prev) => {
    if (s.settings !== prev.settings) applyAppearance(s.settings)
  })

  const mq = matchMedia('(max-width: 760px)')
  const setMobile = () => useStore.setState({ isMobile: mq.matches, sidebarOpen: mq.matches ? false : useStore.getState().sidebarOpen })
  mq.addEventListener('change', setMobile)
  setMobile()

  let wsId = await kvGet<string>('currentWs')
  if (!wsId) {
    wsId = crypto.randomUUID()
    await kvSet('currentWs', wsId)
  }
  // Signed in before: act as that user straight away, and queue changes for the server even
  // before the sync layer connects (or while offline).
  const user = await kvGet<{ id: string; name: string }>('sync:user')
  setActor(user ?? { id: 'local', name: store.settings.userName })
  const role = await kvGet<string>(`sync:role:${wsId}`)
  if (user && role && role !== 'viewer' && (await kvGet(`sync:linked:${wsId}`))) {
    setSyncHook((docId, update) => void outboxAdd(docId, update))
  }
  const w = await Workspace.open(wsId)
  installMarkdownHooks()
  useStore.setState({ ws: w })

  let firstPage: string | null = null
  // A workspace that lives on the server fills in through sync; only brand-new local ones get the guide
  if (w.pages.size === 0 && !(await kvGet(`sync:remote:${wsId}`))) firstPage = await seedWelcome(w)

  const actorId = () => getActor().id
  useStore.setState({
    pages: w.snapshot(),
    wsName: (w.meta.get('name') as string) || '',
    favorites: w.favorites(actorId()),
    ready: true,
  })
  w.observe((changed) => {
    const prev = useStore.getState().pages
    const next = { ...prev }
    changed.forEach((id) => {
      const m = w.page(id)
      if (m) next[id] = w.toMeta(id, m)
      else delete next[id]
    })
    useStore.setState({ pages: next })
  })
  w.prefs.observe(() => useStore.setState({ favorites: w.favorites(actorId()) }))
  w.meta.observe(() => useStore.setState({ wsName: (w.meta.get('name') as string) || '' }))

  initRouter()
  if (firstPage && !useStore.getState().isMobile) navigate(firstPage, { replace: true })
  const action = takePendingAction()
  if (action === 'new') navigate(w.createPage({ parentId: null }), { replace: true })
  else if (action === 'search') useStore.getState().openModal('search')
  void import('../sync/session').then((m) => m.initSync()).catch(() => {})

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      const st = useStore.getState()
      st.modal === 'search' ? st.closeModal() : st.openModal('search')
    } else if (mod && e.key === '\\') {
      e.preventDefault()
      useStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))
    }
  })
}
