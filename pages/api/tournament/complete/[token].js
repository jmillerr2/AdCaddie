import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end()

  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Missing token' })

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('upload_token', token)
    .single()

  if (tErr || !tournament) return res.status(404).json({ error: 'Tournament not found' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const is_complete = !!body.is_complete

  const { error } = await supabase
    .from('tournaments')
    .update({ is_complete })
    .eq('id', tournament.id)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, is_complete })
}
