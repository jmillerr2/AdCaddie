import { createClient } from '@supabase/supabase-js'
import { detectSequenceType } from '../../../lib/generator'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  // ── GET: validate + return signed upload URL ──────────────────────────────
  if (req.method === 'GET') {
    const { filename, duration, width, height, size } = req.query
    if (!filename || !duration) return res.status(400).json({ error: 'Missing filename or duration' })

    const ext = filename.split('.').pop().toLowerCase()
    if (ext !== 'wmv') return res.status(422).json({ error: 'Only .wmv files are accepted here' })

    const { count } = await supabase
      .from('lpga_ads')
      .select('id', { count: 'exact', head: true })

    const durationSec  = Math.round(parseFloat(duration))
    const n            = String((count || 0) + 1).padStart(2, '0')
    const assignedName = `C-${n}(${durationSec}s)`
    const filePath     = `lpga/${assignedName}.wmv`

    const { data: signData, error: signErr } = await supabase.storage
      .from('ads')
      .createSignedUploadUrl(filePath, { upsert: true })
    if (signErr) return res.status(500).json({ error: signErr.message })

    const w = parseInt(width) || 960
    const h = parseInt(height) || 540

    return res.status(200).json({
      assignedName,
      filePath,
      uploadToken: signData.token,
      sequenceType: detectSequenceType(w, h) || 'MainContent',
      width: w,
      height: h,
    })
  }

  // ── POST: register in DB after client has stored the file ─────────────────
  if (req.method === 'POST') {
    const { assignedName, filePath, originalFilename, sequenceType, width, height, sizeBytes } = req.body
    if (!assignedName || !filePath) return res.status(400).json({ error: 'Missing required fields' })

    const { data: urlData } = supabase.storage.from('ads').getPublicUrl(filePath)

    const { data: ad, error: dbErr } = await supabase
      .from('lpga_ads')
      .insert({
        assigned_name:     assignedName,
        original_filename: originalFilename,
        sequence_type:     sequenceType || 'MainContent',
        file_path:         filePath,
        file_url:          urlData.publicUrl,
        width:             parseInt(width)     || 960,
        height:            parseInt(height)    || 540,
        is_video:          true,
        size_bytes:        parseInt(sizeBytes) || 0,
        is_active:         true,
      })
      .select()
      .single()

    if (dbErr) return res.status(500).json({ error: dbErr.message })
    return res.status(200).json({ ad })
  }

  return res.status(405).end()
}
