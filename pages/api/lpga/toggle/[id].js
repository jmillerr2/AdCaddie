import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end()

  const { id } = req.query
  const { is_active } = req.body
  if (!id || is_active === undefined) return res.status(400).json({ error: 'Missing id or is_active' })

  const { error } = await supabase
    .from('lpga_ads')
    .update({ is_active })
    .eq('id', id)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
