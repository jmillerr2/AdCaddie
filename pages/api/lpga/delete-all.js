import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()

  const { data: ads, error: fetchErr } = await supabase
    .from('lpga_ads')
    .select('id, file_path')

  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  if (!ads?.length) return res.status(200).json({ ok: true, deleted: 0 })

  const filePaths = ads.map(a => a.file_path)
  await supabase.storage.from('ads').remove(filePaths)

  const { error: dbErr } = await supabase
    .from('lpga_ads')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (dbErr) return res.status(500).json({ error: dbErr.message })

  return res.status(200).json({ ok: true, deleted: ads.length })
}
