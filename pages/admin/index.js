import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import styles from './admin.module.css'

const SLOTS = [
  { type: 'MainContent', label: 'Main Content', short: 'MC', color: '#c8f060', dim: '960×540' },
  { type: 'RightRail',   label: 'Right Rail',   short: 'RR', color: '#60c8f0', dim: '320×540' },
  { type: 'Header',      label: 'Header',        short: 'H',  color: '#f0c060', dim: '1280×120' },
  { type: 'Ticker',      label: 'Ticker',        short: 'T',  color: '#c060f0', dim: '1280×60' },
]

function getStatus(uploads) {
  const total = (uploads || []).length
  if (total === 0) return 'empty'
  const hasAll = SLOTS.every(s => (uploads || []).some(u => u.sequence_type === s.type))
  return hasAll ? 'complete' : 'progress'
}

function StatusBadge({ status }) {
  const map = {
    empty:    { label: 'Not started', cls: styles.badgeEmpty },
    progress: { label: 'In progress',  cls: styles.badgeProgress },
    complete: { label: 'Complete',     cls: styles.badgeComplete },
  }
  const { label, cls } = map[status]
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

function ProgressRing({ uploads }) {
  const filled = SLOTS.filter(s => (uploads || []).some(u => u.sequence_type === s.type)).length
  const pct    = filled / SLOTS.length
  const r = 22, cx = 28, cy = 28
  const circ = 2 * Math.PI * r
  const dash  = circ * pct
  const color = pct === 0 ? '#2a2d35' : pct === 1 ? '#c8f060' : '#60c8f0'
  return (
    <svg width="56" height="56" className={styles.ring}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2127" strokeWidth="5" />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={cx} y={cy + 5} textAnchor="middle" fill={pct === 0 ? '#444' : color}
        fontSize="12" fontWeight="700" fontFamily="'DM Mono', monospace">
        {filled}/{SLOTS.length}
      </text>
    </svg>
  )
}

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
  const [filter, setFilter]           = useState('all')
  const [expanded, setExpanded]       = useState({})

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
      .select(`*, uploads(id, sequence_type, assigned_name, is_video, original_filename, file_url, width, height, size_bytes, created_at)`)
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
      name: newName.trim(), slug, notes: newNotes.trim()
    })
    if (!error) { setNewName(''); setNewNotes(''); loadTournaments() }
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
      .from('uploads').select('*').eq('tournament_id', tournament.id)
    const { generateElementsJSON, generateSequencesJSON } = await import('../../lib/generator')
    if (type === 'elements') {
      downloadJSON(generateElementsJSON(uploads || []), `${tournament.name}-elements.json`)
    } else if (type === 'sequences') {
      downloadJSON(generateSequencesJSON(uploads || []), `${tournament.name}-sequences.json`)
    } else {
      downloadJSON(generateElementsJSON(uploads || []), `${tournament.name}-elements.json`)
      setTimeout(() => downloadJSON(generateSequencesJSON(uploads || []), `${tournament.name}-sequences.json`), 400)
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

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const filtered = tournaments.filter(t =>
    filter === 'all' ? true : getStatus(t.uploads) === filter
  )

  const stats = {
    total:    tournaments.length,
    complete: tournaments.filter(t => getStatus(t.uploads) === 'complete').length,
    progress: tournaments.filter(t => getStatus(t.uploads) === 'progress').length,
    empty:    tournaments.filter(t => getStatus(t.uploads) === 'empty').length,
    files:    tournaments.reduce((acc, t) => acc + (t.uploads || []).length, 0),
  }

  // ── LOGIN ──
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

  // ── DASHBOARD ──
  return (
    <div className={styles.wrap}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoMark}>⛳</span>
          <span className={styles.logoText}>AdCaddie</span>
          <span className={styles.headerSub}>Admin</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.refreshBtn} onClick={loadTournaments} title="Refresh data">↻</button>
          <button className={styles.logoutBtn} onClick={() => { sessionStorage.removeItem('ac_admin'); setAuthed(false) }}>
            Sign out
          </button>
        </div>
      </header>

      <div className={styles.container}>

        {/* Summary stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{stats.total}</div>
            <div className={styles.statLabel}>Total tournaments</div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardComplete}`}>
            <div className={styles.statNum} style={{ color: '#c8f060' }}>{stats.complete}</div>
            <div className={styles.statLabel}>Complete</div>
            <div className={styles.statBar}>
              <div className={styles.statBarFill} style={{ width: stats.total ? `${(stats.complete / stats.total) * 100}%` : '0%', background: '#c8f060' }} />
            </div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardProgress}`}>
            <div className={styles.statNum} style={{ color: '#60c8f0' }}>{stats.progress}</div>
            <div className={styles.statLabel}>In progress</div>
            <div className={styles.statBar}>
              <div className={styles.statBarFill} style={{ width: stats.total ? `${(stats.progress / stats.total) * 100}%` : '0%', background: '#60c8f0' }} />
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{stats.empty}</div>
            <div className={styles.statLabel}>Not started</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{stats.files}</div>
            <div className={styles.statLabel}>Files uploaded</div>
          </div>
        </div>

        {/* Create tournament */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>+ New Tournament</div>
          <form onSubmit={createTournament}>
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

        {/* Filter tabs */}
        <div className={styles.filterRow}>
          {[
            { key: 'all',      label: 'All',          count: stats.total },
            { key: 'complete', label: 'Complete',      count: stats.complete },
            { key: 'progress', label: 'In progress',   count: stats.progress },
            { key: 'empty',    label: 'Not started',   count: stats.empty },
          ].map(f => (
            <button
              key={f.key}
              className={`${styles.filterTab} ${filter === f.key ? styles.filterTabActive : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className={styles.filterCount}>{f.count}</span>
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <span>Loading tournaments…</span>
          </div>
        )}

        {/* Tournament cards */}
        {!loading && filtered.map(t => {
          const status     = getStatus(t.uploads)
          const isOpen     = expanded[t.id]
          const totalFiles = (t.uploads || []).length

          return (
            <div key={t.id} className={`${styles.tournCard} ${styles[`status_${status}`]}`}>

              {/* Card top */}
              <div className={styles.tournTop}>
                <div className={styles.tournLeft}>
                  <ProgressRing uploads={t.uploads} />
                  <div className={styles.tournInfo}>
                    <div className={styles.tournName}>{t.name}</div>
                    {t.notes && <div className={styles.tournNotes}>{t.notes}</div>}
                    <div className={styles.tournMeta}>
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {totalFiles > 0 && <> · <span>{totalFiles} file{totalFiles !== 1 ? 's' : ''}</span></>}
                    </div>
                  </div>
                </div>
                <div className={styles.tournRight}>
                  <StatusBadge status={status} />
                  <div className={styles.tournActions}>
                    <button className={styles.copyBtn} onClick={() => copyLink(t.upload_token)}>
                      {copied === t.upload_token ? '✓ Copied' : '🔗 Upload link'}
                    </button>
                    <button
                      className={styles.expandBtn}
                      onClick={() => toggleExpand(t.id)}
                      aria-label={isOpen ? 'Collapse' : 'Expand files'}
                    >
                      {isOpen ? '▲' : '▼'}
                    </button>
                    <button className={styles.btnDanger} onClick={() => deleteTournament(t.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Slot indicators */}
              <div className={styles.slotRow}>
                {SLOTS.map(s => {
                  const count  = (t.uploads || []).filter(u => u.sequence_type === s.type).length
                  const filled = count > 0
                  return (
                    <div key={s.type} className={styles.slotItem} title={`${s.label} · ${s.dim} · ${count} file${count !== 1 ? 's' : ''}`}>
                      <div
                        className={styles.slotPip}
                        style={{
                          background: filled ? s.color + '22' : 'transparent',
                          borderColor: filled ? s.color : '#2a2d35',
                        }}
                      >
                        <span style={{ color: filled ? s.color : '#3a3d45', fontSize: 10, fontWeight: 700 }}>
                          {s.short}
                        </span>
                      </div>
                      <div className={styles.slotCount} style={{ color: filled ? s.color : '#444' }}>
                        {filled ? `×${count}` : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Expanded file list */}
              {isOpen && (
                <div className={styles.fileList}>
                  {SLOTS.map(s => {
                    const slotUps = (t.uploads || []).filter(u => u.sequence_type === s.type)
                    return (
                      <div key={s.type} className={styles.fileGroup}>
                        <div className={styles.fileGroupHeader}>
                          <span style={{ color: s.color }}>{s.label}</span>
                          <span className={styles.fileGroupDim}>{s.dim}</span>
                          {slotUps.length === 0 && (
                            <span className={styles.fileMissing}>No files uploaded</span>
                          )}
                        </div>
                        {slotUps.length > 0 && (
                          <div className={styles.fileItems}>
                            {slotUps.map(u => (
                              <div key={u.id} className={styles.fileItem}>
                                <div className={styles.fileThumbBox}>
                                  {u.is_video
                                    ? <div className={styles.videoThumb}>▶</div>
                                    : <img src={u.file_url} alt={u.assigned_name} className={styles.fileThumbImg} />
                                  }
                                </div>
                                <div className={styles.fileInfo}>
                                  <span className={styles.fileAssigned} style={{ color: s.color }}>{u.assigned_name}</span>
                                  <span className={styles.fileOrig}>{u.original_filename}</span>
                                  <span className={styles.fileDims}>{u.width}×{u.height} · {Math.round((u.size_bytes || 0) / 1024)} KB</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Export row */}
              <div className={styles.exportRow}>
                <span className={styles.exportLabel}>Export:</span>
                <button className={styles.btnExport} onClick={() => exportJSON(t, 'elements')} disabled={!!exporting || totalFiles === 0}>
                  {exporting === `${t.id}-elements` ? '…' : '⬇ elements.json'}
                </button>
                <button className={styles.btnExport} onClick={() => exportJSON(t, 'sequences')} disabled={!!exporting || totalFiles === 0}>
                  {exporting === `${t.id}-sequences` ? '…' : '⬇ sequences.json'}
                </button>
                <button className={styles.btnAccentSm} onClick={() => exportJSON(t, 'both')} disabled={!!exporting || totalFiles === 0}>
                  {exporting === `${t.id}-both` ? '…' : '⬇ Both'}
                </button>
              </div>
            </div>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>
            {filter === 'all'
              ? 'No tournaments yet. Create one above.'
              : `No ${filter === 'progress' ? 'in-progress' : filter} tournaments right now.`
            }
          </div>
        )}

      </div>
    </div>
  )
}
