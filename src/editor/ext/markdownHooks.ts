// Late-bound helpers used when turning custom nodes into text/Markdown.
// The app fills these in at startup so the editor schema stays free of store imports.
export const markdownHooks = {
  pageTitle: (_id: string): string => '',
  pageLink: (_id: string): string => '',
  date: (iso: string): string => iso ?? '',
  reminder: (at: number): string => {
    if (!at) return ''
    const d = new Date(at)
    const p = (n: number) => String(n).padStart(2, '0')
    return `⏰ ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  },
  database: (_id: string): string => '',
}
