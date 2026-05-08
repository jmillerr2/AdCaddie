import { createClient } from '@supabase/supabase-js'
import { detectSequenceType, assignName } from '../../../lib/generator'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

export default async function handler(req, res) {
  const { token } = req.query

  // ── GET: validate file + return signed upload URL ──────────────────────────
  if (req.method === 'GET') {
    const { filename, width, height, size, duration } = req.query
    if (!filename) return res.status(400).json({ error: 'Missing filename' })

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('id, name, deadline')
      .eq('upload_token', token)
      .single()
    if (tErr || !tournament) return res.status(404).json({ error: 'Tournament not found' })

    const ext = filename.split('.').pop().toLowerCase()
    if (!['jpg', 'jpeg', 'wmv'].includes(ext)) {
      return res.status(422).json({ error: `File type ".${ext}" is not accepted. Only .jpg, .jpeg and .wmv are allowed.` })
    }

    const sizeBytes = parseInt(size) || 0
    if (sizeBytes > MAX_SIZE) {
      return res.status(422).json({
        error: `File is too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Maximum size is 20 MB.`
      })
    }

    const isVideo = ext === 'wmv'
    const w = parseInt(width) || 0
    const h = parseInt(height) || 0
    let sequenceType = null

    if (!isVideo) {
      sequenceType = detectSequenceType(w, h)
      if (!sequenceType) {
        return res.status(422).json({
          error: `Invalid image dimensions: ${w}x${h}. Expected 960x540, 320x540, 1280x120, or 1280x60.`
        })
      }
    } else {
      sequenceType = detectSequenceType(w, h) || 'MainContent'
    }

    const { count } = await supabase
      .from('uploads')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournament.id)
      .eq('sequence_type', sequenceType)

    const durationSec  = isVideo && duration ? parseFloat(duration) : null
    const assignedName = assignName(sequenceType, count || 0, durationSec)
    const filePath = `${tournament.id}/${assignedName}.${ext}`

    const { data: signData, error: signErr } = await supabase.storage
      .from('ads')
      .createSignedUploadUrl(filePath)
    if (signErr) return res.status(500).json({ error: signErr.message })

    const isLate = !!(tournament.deadline && new Date() > new Date(tournament.deadline))

    return res.status(200).json({
      assignedName,
      filePath,
      sequenceType,
      uploadToken: signData.token,
      isLate,
      tournamentId: tournament.id,
      width: w,
      height: h,
      isVideo,
    })
  }

  // ── POST: register upload in DB after client has stored the file ───────────
  if (req.method === 'POST') {
    const body = req.body
    const { assignedName, filePath, sequenceType, originalFilename, width, height, isVideo, sizeBytes, isLate, tournamentId } = body

    if (!assignedName || !filePath || !tournamentId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const { data: urlData } = supabase.storage.from('ads').getPublicUrl(filePath)

    const { data: upload, error: dbErr } = await supabase
      .from('uploads')
      .insert({
        tournament_id:     tournamentId,
        original_filename: originalFilename,
        assigned_name:     assignedName,
        sequence_type:     sequenceType,
        file_path:         filePath,
        file_url:          urlData.publicUrl,
        width,
        height,
        is_video:          isVideo,
        size_bytes:        sizeBytes,
        is_late:           isLate,
      })
      .select()
      .single()

    if (dbErr) return res.status(500).json({ error: dbErr.message })

    supabase.from('activity_log').insert({
      tournament_id:  tournamentId,
      event_type:     'upload',
      filename:       originalFilename,
      assigned_name:  assignedName,
      sequence_type:  sequenceType,
      is_late:        isLate,
      metadata:       { size_bytes: sizeBytes, width, height, is_video: isVideo }
    }).then(() => {})

    return res.status(200).json({ upload })
  }

  return res.status(405).end()
}
