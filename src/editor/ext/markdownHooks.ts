// Late-bound helpers used when turning custom nodes into text/Markdown.
// The app fills these in at startup so the editor schema stays free of store imports.
export const markdownHooks = {
  pageTitle: (_id: string): string => '',
  pageLink: (_id: string): string => '',
  date: (iso: string): string => iso ?? '',
  database: (_id: string): string => '',
}
