import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing id' })

  // Get the upload record
  const { data: upload, error: fetchErr } = await supabase
    .from('uploads')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !upload) return res.status(404).json({ error: 'Upload not found' })

  // Delete from storage
  const { error: storageErr } = await supabase.storage
    .from('ads')
    .remove([upload.file_path])

  if (storageErr) return res.status(500).json({ error: storageErr.message })

  // Delete from database
  const { error: dbErr } = await supabase
    .from('uploads')
    .delete()
    .eq('id', id)

  if (dbErr) return res.status(500).json({ error: dbErr.message })

  return res.status(200).json({ ok: true })
}
