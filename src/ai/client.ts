// Writing assistant client: streams from the Claude Messages API, either directly with the
// user's own key (personal use) or through the app's server function when signed in.
import { useStore } from '../data/store'
import type { AiAction } from './aiBus'

export class AiError extends Error {
  code: 'nokey' | 'quota' | 'network' | 'api'
  constructor(code: AiError['code'], message: string) {
    super(message)
    this.code = code
  }
}

type ServerAi = (body: unknown, signal: AbortSignal) => Promise<Response>
let serverAi: ServerAi | null = null
/** The sync layer registers a server endpoint when the user is signed in. */
export function setServerAi(fn: ServerAi | null) {
  serverAi = fn
}

const SYSTEM = `You are the writing assistant inside "Qirtas", an Arabic-first notes and tasks app.
Rules:
- Reply with the result only. No preamble, no explanations, no quotes around the result.
- Write in Markdown that the app turns into blocks: "## " for headings, "- " for bullets, "1. " for numbered lists, "- [ ] " for tasks, "> " for quotes, **bold** for emphasis.
- Keep the language of the source text unless the task asks for a translation.
- Arabic output must be correct Modern Standard Arabic unless the task says otherwise; keep names, numbers and dates exactly as written.
- Never invent facts that are not in the source text.`

const TASKS: Record<Exclude<AiAction, 'custom'>, string> = {
  continue: 'Continue the text naturally in the same language, voice and format. Write only the continuation (one or two short paragraphs or list items).',
  summarize: 'Summarize the text. Start with a line "**الخلاصة**" (or "**Summary**" if the text is English), then 3–6 short bullet points.',
  fix: 'Correct spelling, grammar, punctuation and hamza/taa-marbuta mistakes. Keep the meaning, wording and formatting as close to the original as possible.',
  fusha: 'Rewrite the text from colloquial/dialect Arabic (Gulf or any other dialect) into clear Modern Standard Arabic (فصحى). Keep the meaning and formatting.',
  toEnglish: 'Translate the text into natural English. Keep the formatting.',
  toArabic: 'Translate the text into natural Modern Standard Arabic. Keep the formatting.',
  shorter: 'Rewrite the text to be noticeably shorter while keeping every important point and the same language.',
  longer: 'Expand the text with useful detail, keeping the same language, tone and format.',
  tasks: 'Extract the concrete action items from the text as a task list ("- [ ] ..."). If there are none, write the single most useful next step as one task.',
}

export const VOICE_TASK =
  'The text is a raw voice transcript. Turn it into a tidy note: a short "## " heading, then the content as clear paragraphs or bullet points, and any to-dos as "- [ ] " tasks. Fix obvious transcription errors. Keep the speaker’s language (Arabic stays Arabic).'

export function buildPrompt(action: AiAction, source: string, custom?: string): string {
  const task = action === 'custom' ? `The user asks: ${custom}` : TASKS[action]
  return source.trim() ? `${task}\n\n<text>\n${source}\n</text>` : task
}

function modelParams(model: 'fast' | 'smart') {
  return model === 'fast'
    ? { model: 'claude-haiku-5-5', output_config: { effort: 'low' }, thinking: { type: 'disabled' } }
    : { model: 'claude-sonnet-5-5', output_config: { effort: 'low' }, thinking: { type: 'between_tools' } }
}

/** Stream a completion; calls onText with the accumulated text. */
export async function streamAi(prompt: string, onText: (full: string) => void, signal: AbortSignal): Promise<string> {
  const { aiKey, aiModel } = useStore.getState().settings
  const body = {
    ...modelParams(aiModel),
    max_tokens: 4096,
    stream: true,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  }
  let res: Response
  try {
    if (serverAi && !aiKey) res = await serverAi(body, signal)
    else if (aiKey) {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': aiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })
    } else throw new AiError('nokey', 'no key')
  } catch (e) {
    if (e instanceof AiError) throw e
    if ((e as Error).name === 'AbortError') throw e
    throw new AiError('network', (e as Error).message)
  }
  if (res.status === 429 && serverAi && !aiKey) throw new AiError('quota', 'quota')
  // The server assistant isn't set up yet (function not deployed, or no API key on the server)
  if ((res.status === 404 || res.status === 503) && serverAi && !aiKey) throw new AiError('nokey', 'server assistant unavailable')
  if (!res.ok || !res.body) {
    let msg = `${res.status}`
    try {
      const j = await res.json()
      msg = j?.error?.message ?? msg
    } catch {
      /* ignore */
    }
    throw new AiError('api', msg)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const ev = JSON.parse(data)
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          full += ev.delta.text
          onText(full)
        } else if (ev.type === 'error') {
          throw new AiError('api', ev.error?.message ?? 'error')
        }
      } catch (err) {
        if (err instanceof AiError) throw err
      }
    }
  }
  return full
}
