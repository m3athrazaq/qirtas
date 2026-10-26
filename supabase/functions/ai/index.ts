// Supabase Edge Function "ai": the writing assistant for signed-in users.
// Counts the caller's monthly uses, then streams the answer from the Claude API.
// Secrets: ANTHROPIC_API_KEY (required), AI_MONTHLY_LIMIT (optional, default 300).
// It acts as the caller (their own login), so it needs no secret Supabase key.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
// Limits that keep one account from running up the bill (the app sends far less than this)
const MAX_BODY_CHARS = 200_000
const MAX_MESSAGES = 40
const EFFORTS = ['low', 'medium']
const THINKING = ['disabled', 'between_tools']

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

/** The project's public key: from the request, else from the function's environment. */
function publicKey(req: Request): string {
  const fromRequest = req.headers.get('apikey')
  if (fromRequest) return fromRequest
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
    const first = keys.default ?? Object.values(keys)[0]
    if (first) return first
  } catch {
    /* not set */
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: { message: 'method not allowed' } })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(503, { error: { message: 'ANTHROPIC_API_KEY is not set', code: 'noserver' } })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: { message: 'unauthorized' } })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publicKey(req), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData } = await sb.auth.getUser(token)
  if (!userData?.user) return json(401, { error: { message: 'unauthorized' } })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_CHARS) return json(413, { error: { message: 'request too large' } })
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: { message: 'bad request' } })
  }
  const messages = body.messages
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > MAX_MESSAGES ||
    !messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))
  ) {
    return json(400, { error: { message: 'bad request' } })
  }

  // ai_count_use returns the count including this call, so `>` allows exactly `limit` calls
  const limit = Number(Deno.env.get('AI_MONTHLY_LIMIT') ?? '300')
  const { data: used, error } = await sb.rpc('ai_count_use')
  if (error) {
    console.error('ai_count_use failed', error)
    return json(500, { error: { message: 'server error' } })
  }
  if (Number(used) > limit) return json(429, { error: { message: 'quota', code: 'quota' } })

  // Only settings the app itself uses are passed on; anything else falls back to the cheap default
  const model = MODELS.includes(String(body.model)) ? String(body.model) : MODELS[0]
  const effort = (body.output_config as { effort?: unknown } | undefined)?.effort
  const thinking = (body.thinking as { type?: unknown } | undefined)?.type
  const payload = {
    model,
    max_tokens: Math.min(Number(body.max_tokens) || 2048, 4096),
    stream: true,
    system: typeof body.system === 'string' ? body.system.slice(0, 20_000) : undefined,
    messages,
    output_config: { effort: EFFORTS.includes(String(effort)) ? String(effort) : 'low' },
    thinking: { type: THINKING.includes(String(thinking)) ? String(thinking) : 'disabled' },
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload),
  })
  return new Response(res.body, {
    status: res.status,
    headers: { ...cors, 'content-type': res.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' },
  })
})
