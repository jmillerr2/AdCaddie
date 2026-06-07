import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { name, notes, deadline } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Tournament name is required' })

  const insertData = {
    name:         name.trim(),
    notes:        (notes || '').trim(),
    upload_token: randomUUID(),
  }

  if (deadline) {
    try {
      insertData.deadline = new Date(deadline).toISOString()
    } catch {
      return res.status(400).json({ error: 'Invalid deadline date' })
    }
  }

  const { data: tournament, error } = await supabase
    .from('tournaments')
    .insert(insertData)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ tournament })
}
