// Supabase Edge Function: the writing assistant for signed-in users.
// It checks the user's monthly allowance, then streams the answer from the Claude API.
// Secrets: ANTHROPIC_API_KEY (required), AI_MONTHLY_LIMIT (optional, default 300).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: { message: 'method not allowed' } })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: { message: 'ANTHROPIC_API_KEY is not set' } })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: userData } = await admin.auth.getUser(token)
  const user = userData?.user
  if (!user) return json(401, { error: { message: 'unauthorized' } })

  const limit = Number(Deno.env.get('AI_MONTHLY_LIMIT') ?? '300')
  const month = new Date().toISOString().slice(0, 7)
  const { data: usage } = await admin.from('ai_usage').select('count').eq('user_id', user.id).eq('month', month).maybeSingle()
  const used = usage?.count ?? 0
  if (used >= limit) return json(429, { error: { message: 'quota' } })
  await admin.from('ai_usage').upsert({ user_id: user.id, month, count: used + 1 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: { message: 'bad request' } })
  }
  const model = MODELS.includes(String(body.model)) ? String(body.model) : MODELS[0]
  const payload = {
    model,
    max_tokens: Math.min(Number(body.max_tokens) || 2048, 4096),
    stream: true,
    system: typeof body.system === 'string' ? body.system : undefined,
    messages: body.messages,
    output_config: body.output_config,
    thinking: body.thinking,
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
