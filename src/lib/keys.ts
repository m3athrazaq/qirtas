// Keyboard helpers shared by the app-wide shortcuts.

/** The letter of a shortcut: what the layout types when it is a Latin letter (so Ctrl+Z is the Z key
 *  on AZERTY and QWERTZ too), otherwise the physical key (Arabic and other non-Latin layouts). */
export function shortcutLetter(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  const m = /^Key([A-Z])$/.exec(e.code)
  return m ? m[1].toLowerCase() : ''
}

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Is the keyboard busy typing here (a text field or the editor)? Those keep their own undo and Delete. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type)
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable
}
