import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

// randomBytes is available in all Node versions; randomUUID requires 14.17+
function generateToken() {
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

export default async function handler(req, res) {
  // Always return JSON — never let an unhandled throw produce an HTML 500
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    // Validate env vars up front so the error is clear
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl) return res.status(500).json({ error: 'NEXT_PUBLIC_SUPABASE_URL is not set in Vercel environment variables' })
    if (!supabaseKey) return res.status(500).json({ error: 'Supabase key is not set in Vercel environment variables' })

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { name, notes, deadline } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ error: 'Tournament name is required' })

    const insertData = {
      name:         name.trim(),
      notes:        (notes || '').trim(),
      upload_token: generateToken(),
    }
    if (deadline) {
      insertData.deadline = new Date(deadline).toISOString()
    }

    const { data: tournament, error } = await supabase
      .from('tournaments')
      .insert(insertData)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ tournament })

  } catch (err) {
    console.error('[create-tournament]', err)
    return res.status(500).json({ error: err?.message || 'Unexpected server error' })
  }
}
