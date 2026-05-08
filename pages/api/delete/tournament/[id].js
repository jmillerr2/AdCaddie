import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing tournament id' })

  const { data: uploads, error: fetchErr } = await supabase
    .from('uploads')
    .select('id, file_path, original_filename, assigned_name, sequence_type, size_bytes, tournament_id')
    .eq('tournament_id', id)

  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  if (!uploads?.length) return res.status(200).json({ ok: true, deleted: 0 })

  const filePaths = uploads.map(u => u.file_path)
  await supabase.storage.from('ads').remove(filePaths)

  const { error: dbErr } = await supabase
    .from('uploads')
    .delete()
    .eq('tournament_id', id)

  if (dbErr) return res.status(500).json({ error: dbErr.message })

  supabase.from('activity_log').insert({
    tournament_id: id,
    event_type:    'delete',
    metadata:      { bulk: true, count: uploads.length }
  }).then(() => {})

  return res.status(200).json({ ok: true, deleted: uploads.length })
}
