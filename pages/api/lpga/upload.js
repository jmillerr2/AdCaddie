import { createClient } from '@supabase/supabase-js'
import { detectSequenceType } from '../../../lib/generator'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export const config = {
  api: { bodyParser: false }
}

async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function getBoundary(contentType) {
  const match = contentType.match(/boundary=(.+)$/)
  return match ? match[1] : null
}

function parseMultipart(buffer, boundary) {
  const parts = []
  const sep = Buffer.from(`--${boundary}`)
  let pos = 0

  while (pos < buffer.length) {
    const sepIdx = buffer.indexOf(sep, pos)
    if (sepIdx === -1) break
    pos = sepIdx + sep.length
    if (buffer.slice(pos, pos + 2).equals(Buffer.from('--'))) break
    pos += 2

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos)
    if (headerEnd === -1) break
    const headerStr = buffer.slice(pos, headerEnd).toString()
    pos = headerEnd + 4

    const nextSep = buffer.indexOf(sep, pos)
    if (nextSep === -1) break
    const body = buffer.slice(pos, nextSep - 2)
    pos = nextSep

    const headers = {}
    headerStr.split('\r\n').forEach(line => {
      const [key, ...vals] = line.split(': ')
      if (key) headers[key.toLowerCase()] = vals.join(': ')
    })

    const fileMatch = (headers['content-disposition'] || '').match(/filename="([^"]+)"/)
    const filename  = fileMatch ? fileMatch[1] : null
    const type      = headers['content-type'] || 'application/octet-stream'
    parts.push({ filename, type, body })
  }
  return parts
}

async function getImageDimensions(buffer) {
  try {
    const sharp = (await import('sharp')).default
    const meta  = await sharp(buffer).metadata()
    return { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const contentType = req.headers['content-type'] || ''
  const boundary    = getBoundary(contentType)
  if (!boundary) return res.status(400).json({ error: 'No boundary in content-type' })

  const rawBody  = await parseForm(req)
  const parts    = parseMultipart(rawBody, boundary)
  const filePart = parts.find(p => p.filename)
  if (!filePart) return res.status(400).json({ error: 'No file found in upload' })

  const { filename, type: mimeType, body: fileBuffer } = filePart
  const ext     = filename.split('.').pop().toLowerCase()
  const isVideo = ext === 'wmv'

  if (!['jpg', 'jpeg', 'wmv'].includes(ext)) {
    return res.status(422).json({ error: `File type ".${ext}" is not accepted. Only .jpg, .jpeg (images) and .wmv (videos) are allowed.` })
  }

  let width = 0, height = 0, sequenceType = null

  if (!isVideo) {
    const dims = await getImageDimensions(fileBuffer)
    if (dims) { width = dims.width; height = dims.height }
    sequenceType = detectSequenceType(width, height)
    if (!sequenceType) {
      return res.status(422).json({
        error: `Invalid image dimensions: ${width}x${height}. Expected 960x540, 320x540, 1280x120, or 1280x60.`
      })
    }
  } else {
    const qw = parseInt(req.query.width)
    const qh = parseInt(req.query.height)
    if (qw && qh) {
      width = qw; height = qh
      sequenceType = detectSequenceType(width, height)
    }
    if (!sequenceType) {
      sequenceType = 'MainContent'
      width = 960; height = 540
    }
  }

  // Assign next C-XX name globally across all lpga_ads
  const { count } = await supabase
    .from('lpga_ads')
    .select('id', { count: 'exact', head: true })

  // Include duration suffix for videos: C-01(30s)
  let durationSec = isVideo ? parseFloat(req.query.duration) : null
  if (isVideo && (!durationSec || isNaN(durationSec))) {
    const m = filename.match(/\((\d+)s?\)/)
    if (m) durationSec = parseInt(m[1])
  }
  const dur = (isVideo && durationSec) ? `(${Math.round(durationSec)}s)` : ''
  const n = String((count || 0) + 1).padStart(2, '0')
  const assignedName = `C-${n}${dur}`
  const filePath     = `lpga/${assignedName}.${ext}`

  const { error: storageErr } = await supabase.storage
    .from('ads')
    .upload(filePath, fileBuffer, { contentType: mimeType, upsert: false })

  if (storageErr) return res.status(500).json({ error: storageErr.message })

  const { data: urlData } = supabase.storage.from('ads').getPublicUrl(filePath)

  const { data: ad, error: dbErr } = await supabase
    .from('lpga_ads')
    .insert({
      assigned_name:     assignedName,
      original_filename: filename,
      sequence_type:     sequenceType,
      file_path:         filePath,
      file_url:          urlData.publicUrl,
      width,
      height,
      is_video:          isVideo,
      size_bytes:        fileBuffer.length,
      is_active:         true,
    })
    .select()
    .single()

  if (dbErr) return res.status(500).json({ error: dbErr.message })

  return res.status(200).json({ ad })
}
