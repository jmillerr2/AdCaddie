import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import styles from './admin.module.css'

export default function Admin() {
  const [authed, setAuthed]           = useState(false)
  const [password, setPassword]       = useState('')
  const [authError, setAuthError]     = useState('')
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading]         = useState(false)
  const [creating, setCreating]       = useState(false)
  const [newName, setNewName]         = useState('')
  const [newNotes, setNewNotes]       = useState('')
  const [copied, setCopied]           = useState(null)
  const [exporting, setExporting]     = useState(null)

  // Check session
  useEffect(() => {
    const saved = sessionStorage.getItem('ac_admin')
    if (saved === 'true') { setAuthed(true); loadTournaments() }
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    if (res.ok) {
      sessionStorage.setItem('ac_admin', 'true')
      setAuthed(true)
      loadTournaments()
    } else {
      setAuthError('Incorrect password')
    }
  }

  async function loadTournaments() {
    setLoading(true)
    const { data, error } = await supabase
      .from('tournaments')
      .select(`*, uploads(id, sequence_type, assigned_name, is_video)`)
      .order('created_at', { ascending: false })
    if (!error) setTournaments(data || [])
    setLoading(false)
  }

  async function createTournament(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const slug = newName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
    const { error } = await supabase.from('tournaments').insert({
      name: newName.trim(),
      slug,
      notes: newNotes.trim()
    })
    if (!error) {
      setNewName(''); setNewNotes('')
      loadTournaments()
    }
    setCreating(false)
  }

  async function deleteTournament(id) {
    if (!confirm('Delete this tournament and all its uploads?')) return
    await supabase.from('tournaments').delete().eq('id', id)
    loadTournaments()
  }

  function copyLink(token) {
    const url = `${window.location.origin}/upload/${token}`
    navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  async function exportJSON(tournament, type) {
    setExporting(`${tournament.id}-${type}`)
    const { data: uploads } = await supabase
      .from('uploads')
      .select('*')
      .eq('tournament_id', tournament.id)

    const { generateElementsJSON, generateSequencesJSON } = await import('../../lib/generator')

    if (type === 'elements') {
      const json = generateElementsJSON(uploads || [])
      downloadJSON(json, `${tournament.name}-elements.json`)
    } else if (type === 'sequences') {
      const json = generateSequencesJSON(uploads || [])
      downloadJSON(json, `${tournament.name}-sequences.json`)
    } else {
      const els = generateElementsJSON(uploads || [])
      const seq = generateSequencesJSON(uploads || [])
      downloadJSON(els, `${tournament.name}-elements.json`)
      setTimeout(() => downloadJSON(seq, `${tournament.name}-sequences.json`), 400)
    }
    setExporting(null)
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function uploadCount(t, type) {
    return (t.uploads || []).filter(u => u.sequence_type === type).length
  }

  // ── LOGIN SCREEN ──
  if (!authed) return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <div className={styles.loginLogo}>
          <span className={styles.logoMark}>⛳</span>
          <span className={styles.logoText}>AdCaddie</span>
        </div>
        <div className={styles.loginSub}>Admin Portal</div>
        <form onSubmit={handleLogin} className={styles.loginForm}>
          <input
            type="password"
            placeholder="Enter admin password"
            value={password}
            onChange={e => { setPassword(e.target.value); setAuthError('') }}
            className={styles.loginInput}
            autoFocus
          />
          {authError && <div className={styles.authError}>{authError}</div>}
          <button type="submit" className={styles.loginBtn}>Sign In →</button>
        </form>
      </div>
    </div>
  )

  // ── ADMIN DASHBOARD ──
  return (
    <div className={styles.wrap}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoMark}>⛳</span>
          <span className={styles.logoText}>AdCaddie</span>
          <span className={styles.headerSub}>Admin</span>
        </div>
        <button className={styles.logoutBtn} onClick={() => { sessionStorage.removeItem('ac_admin'); setAuthed(false) }}>
          Sign out
        </button>
      </header>

      <div className={styles.container}>
        {/* Create tournament */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>+ New Tournament</div>
          <form onSubmit={createTournament} className={styles.createForm}>
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label>Tournament name</label>
                <input
                  type="text"
                  placeholder="12-Kroger Queen City Championship"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className={styles.input}
                />
              </div>
              <div className={styles.field}>
                <label>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="Dates, location, contact…"
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className={styles.input}
                />
              </div>
              <button type="submit" className={styles.btnAccent} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>

        {/* Tournaments list */}
        <div className={styles.sectionLabel}>All Tournaments ({tournaments.length})</div>

        {loading && <div className={styles.loading}>Loading…</div>}

        {tournaments.map(t => (
          <div key={t.id} className={styles.tournCard}>
            <div className={styles.tournTop}>
              <div>
                <div className={styles.tournName}>{t.name}</div>
                {t.notes && <div className={styles.tournNotes}>{t.notes}</div>}
                <div className={styles.tournMeta}>
                  Created {new Date(t.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className={styles.tournActions}>
                <button
                  className={styles.copyBtn}
                  onClick={() => copyLink(t.upload_token)}
                >
                  {copied === t.upload_token ? '✓ Copied!' : '🔗 Copy upload link'}
                </button>
                <button
                  className={styles.btnDanger}
                  onClick={() => deleteTournament(t.id)}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Upload status */}
            <div className={styles.slotRow}>
              {[
                { type: 'MainContent', label: 'Main',   color: 'var(--accent2)' },
                { type: 'RightRail',  label: 'RR',     color: 'var(--rr)' },
                { type: 'Header',     label: 'Header',  color: 'var(--header)' },
                { type: 'Ticker',     label: 'Ticker',  color: 'var(--ticker)' },
              ].map(s => {
                const count = uploadCount(t, s.type)
                return (
                  <div key={s.type} className={styles.slot} style={{ borderColor: count > 0 ? s.color : 'var(--border)' }}>
                    <div className={styles.slotCount} style={{ color: count > 0 ? s.color : 'var(--muted)' }}>{count}</div>
                    <div className={styles.slotLabel}>{s.label}</div>
                  </div>
                )
              })}
              <div className={styles.slotTotal}>
                <div className={styles.slotCount} style={{ color: 'var(--accent)' }}>{(t.uploads||[]).length}</div>
                <div className={styles.slotLabel}>Total</div>
              </div>
            </div>

            {/* Export buttons */}
            <div className={styles.exportRow}>
              <span className={styles.exportLabel}>Export:</span>
              <button className={styles.btnExport} onClick={() => exportJSON(t, 'elements')} disabled={!!exporting}>
                {exporting === `${t.id}-elements` ? '…' : '⬇ elements.json'}
              </button>
              <button className={styles.btnExport} onClick={() => exportJSON(t, 'sequences')} disabled={!!exporting}>
                {exporting === `${t.id}-sequences` ? '…' : '⬇ sequences.json'}
              </button>
              <button className={styles.btnAccentSm} onClick={() => exportJSON(t, 'both')} disabled={!!exporting}>
                {exporting === `${t.id}-both` ? '…' : '⬇ Both'}
              </button>
            </div>
          </div>
        ))}

        {!loading && tournaments.length === 0 && (
          <div className={styles.empty}>No tournaments yet. Create one above.</div>
        )}
      </div>
    </div>
  )
}
