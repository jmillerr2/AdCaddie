import { createClient } from '@supabase/supabase-js'
import { detectSequenceType, assignName } from '../../lib/generator'

// Use service role for server-side uploads
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export const config = {
  api: { bodyParser: false }
}

// Parse multipart form manually using built-in Node
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
  const sep   = Buffer.from(`--${boundary}`)
  const end   = Buffer.from(`--${boundary}--`)
  let pos = 0

  while (pos < buffer.length) {
    const sepIdx = buffer.indexOf(sep, pos)
    if (sepIdx === -1) break
    pos = sepIdx + sep.length

    if (buffer.slice(pos, pos + 2).equals(Buffer.from('--'))) break

    // Skip \r\n after boundary
    pos += 2

    // Find end of headers
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos)
    if (headerEnd === -1) break

    const headerStr = buffer.slice(pos, headerEnd).toString()
    pos = headerEnd + 4

    // Find next boundary
    const nextSep = buffer.indexOf(sep, pos)
    if (nextSep === -1) break

    const bodyEnd = nextSep - 2 // strip trailing \r\n
    const body    = buffer.slice(pos, bodyEnd)
    pos = nextSep

    // Parse headers
    const headers = {}
    headerStr.split('\r\n').forEach(line => {
      const [key, ...vals] = line.split(': ')
      if (key) headers[key.toLowerCase()] = vals.join(': ')
    })

    const dispMatch = (headers['content-disposition'] || '').match(/name="([^"]+)"/)
    const fileMatch = (headers['content-disposition'] || '').match(/filename="([^"]+)"/)
    const name      = dispMatch ? dispMatch[1] : null
    const filename  = fileMatch ? fileMatch[1] : null
    const type      = headers['content-type'] || 'application/octet-stream'

    parts.push({ name, filename, type, body })
  }
  return parts
}

async function getImageDimensions(buffer, mimeType) {
  try {
    const sharp = (await import('sharp')).default
    const meta  = await sharp(buffer).metadata()
    return { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

const VIDEO_EXTS = ['wmv', 'mp4', 'mov', 'avi', 'mpg', 'mpeg']
function isVideoFile(filename) {
  return VIDEO_EXTS.includes((filename.split('.').pop() || '').toLowerCase())
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Missing token' })

  // Verify tournament exists
  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('upload_token', token)
    .single()

  if (tErr || !tournament) return res.status(404).json({ error: 'Tournament not found' })

  const contentType = req.headers['content-type'] || ''
  const boundary    = getBoundary(contentType)
  if (!boundary) return res.status(400).json({ error: 'No boundary in content-type' })

  const rawBody = await parseForm(req)
  const parts   = parseMultipart(rawBody, boundary)
  const filePart = parts.find(p => p.filename)

  if (!filePart) return res.status(400).json({ error: 'No file found in upload' })

  const { filename, type: mimeType, body: fileBuffer } = filePart
  const isVideo = isVideoFile(filename)
  const ext     = filename.split('.').pop().toLowerCase()

  // Detect dimensions
  let width = 0, height = 0, sequenceType = null

  if (!isVideo) {
    const dims = await getImageDimensions(fileBuffer, mimeType)
    if (dims) { width = dims.width; height = dims.height }
    sequenceType = detectSequenceType(width, height)
    if (!sequenceType) {
      return res.status(422).json({
        error: `Invalid image dimensions: ${width}x${height}. Expected 960x540, 320x540, 1280x120, or 1280x60.`
      })
    }
  } else {
    // For video, get dimensions from query param (client sends them)
    const qw = parseInt(req.query.width)
    const qh = parseInt(req.query.height)
    if (qw && qh) {
      width = qw; height = qh
      sequenceType = detectSequenceType(width, height)
    }
    if (!sequenceType) {
      // Default video to MainContent if dimensions not provided
      sequenceType = 'MainContent'
      width = 960; height = 540
    }
  }

  // Count existing uploads of this type for this tournament
  const { count } = await supabase
    .from('uploads')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id)
    .eq('sequence_type', sequenceType)

  const assignedName = assignName(sequenceType, count || 0)
  const filePath     = `${tournament.id}/${assignedName}.${ext}`

  // Upload to Supabase Storage
  const { error: storageErr } = await supabase.storage
    .from('ads')
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false
    })

  if (storageErr) {
    return res.status(500).json({ error: storageErr.message })
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from('ads').getPublicUrl(filePath)

  // Save to database
  const { data: upload, error: dbErr } = await supabase
    .from('uploads')
    .insert({
      tournament_id:     tournament.id,
      original_filename: filename,
      assigned_name:     assignedName,
      sequence_type:     sequenceType,
      file_path:         filePath,
      file_url:          urlData.publicUrl,
      width,
      height,
      is_video:          isVideo,
      size_bytes:        fileBuffer.length
    })
    .select()
    .single()

  if (dbErr) return res.status(500).json({ error: dbErr.message })

  return res.status(200).json({ upload })
}
