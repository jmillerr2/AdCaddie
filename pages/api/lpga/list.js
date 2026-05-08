import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data: ads, error } = await supabase
    .from('lpga_ads')
    .select('*')
    .order('assigned_name', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ads: ads || [] })
}
