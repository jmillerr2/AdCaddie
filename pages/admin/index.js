import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import styles from './admin.module.css'

const SYSTEM_ELEMENT_INFO = [
  { key: '_SC',      label: 'Scorecards',    desc: 'Player scoring cards (PlayerScoring_Scorecards)' },
  { key: '_LB',      label: 'Leaderboard',   desc: 'Tournament leaderboard graphic' },
  { key: '_ProjCut', label: 'Projected Cut', desc: 'Projected cut line graphic' },
  { key: '_NOG',     label: 'Next On Green', desc: 'Next player on green locator' },
]

const DEFAULT_SETTINGS = {
  _SC:      { enabled: true,  duration: 24 },
  _LB:      { enabled: true,  duration: 30 },
  _ProjCut: { enabled: true,  duration: 10 },
  _NOG:     { enabled: true,  duration: 10 },
}

const SLOTS = [
  { type: 'MainContent', label: 'Main Content', short: 'MC', color: '#1a5c3a', dim: '960×540' },
  { type: 'RightRail',   label: 'Right Rail',   short: 'RR', color: '#0369a1', dim: '320×540' },
  { type: 'Header',      label: 'Header',        short: 'H',  color: '#b45309', dim: '1280×120' },
  { type: 'Ticker',      label: 'Ticker',        short: 'T',  color: '#7c3aed', dim: '1280×60' },
]

// Same ordering rule as lib/generator.js's bySortOrder — manual drag order first,
// falling back to assigned_name for anything not yet manually reordered.
function bySortOrder(a, b) {
  const ao = a.sort_order ?? Infinity
  const bo = b.sort_order ?? Infinity
  if (ao !== bo) return ao - bo
  return a.assigned_name.localeCompare(b.assigned_name)
}

function getStatus(uploads, isComplete) {
  if (isComplete) return 'complete'
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
  const color = pct === 0 ? '#dee2e6' : pct === 1 ? '#1a5c3a' : '#0369a1'
  return (
    <svg width="56" height="56" className={styles.ring}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f3f5" strokeWidth="5" />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={cx} y={cy + 5} textAnchor="middle" fill={pct === 0 ? '#adb5bd' : color}
        fontSize="12" fontWeight="700" fontFamily="'DM Mono', monospace">
        {filled}/{SLOTS.length}
      </text>
    </svg>
  )
}

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDeadline(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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
  const [newDeadline, setNewDeadline] = useState('')
  const [copied, setCopied]           = useState(null)
  const [exporting, setExporting]     = useState(null)
  const [filter, setFilter]           = useState('all')
  const [expanded, setExpanded]       = useState({})
  const [preview, setPreview]         = useState(null)   // { tournament, elements, sequences, tab }
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [activityLog, setActivityLog] = useState([])
  const [activityFilter, setActivityFilter] = useState('all')
  const [activityOpen, setActivityOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState({})
  const [createError, setCreateError] = useState('')
  const [loadError, setLoadError]       = useState('')
  const [seqBuilderOpen, setSeqBuilderOpen]     = useState(false)
  const [seqBuilderTourn, setSeqBuilderTourn]   = useState(null)
  const [seqBuilderConfigs, setSeqBuilderConfigs] = useState([])
  const [seqBuilderLpgaAds, setSeqBuilderLpgaAds] = useState([])
  const [seqBuilderTemplates, setSeqBuilderTemplates] = useState([])
  const [seqBuilderLoading, setSeqBuilderLoading] = useState(false)
  const [seqExpandedIds, setSeqExpandedIds]     = useState(new Set())
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS)
  const [dragOverCard, setDragOverCard] = useState(null) // `${tournId}:${sequenceType}:${index}`
  const dragUploadRef = useRef(null)

  useEffect(() => {
    const saved = sessionStorage.getItem('ac_admin')
    if (saved === 'true') { setAuthed(true); loadTournaments(); loadActivityLog() }
    try {
      const savedSettings = localStorage.getItem('ac_settings')
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings)
        setSettings(parsed)
        setSettingsDraft(parsed)
      }
    } catch {}
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
      loadActivityLog()
    } else {
      setAuthError('Incorrect password')
    }
  }

  async function loadTournaments() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .from('tournaments')
      .select(`*, uploads(id, sequence_type, assigned_name, is_video, original_filename, file_url, width, height, size_bytes, is_late, sort_order, created_at)`)
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(`Supabase connection error: ${error.message} — check that your project is not paused at app.supabase.com`)
    } else {
      setTournaments(data || [])
    }
    setLoading(false)
  }

  async function loadActivityLog() {
    const { data } = await supabase
      .from('activity_log')
      .select('*, tournaments(name)')
      .order('created_at', { ascending: false })
      .limit(50)
    setActivityLog(data || [])
  }

  async function createTournament(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/admin/create-tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:     newName.trim(),
          notes:    newNotes.trim(),
          deadline: newDeadline || null,
        })
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error || `Server error ${res.status}`)
      } else {
        supabase.from('activity_log').insert({
          tournament_id: json.tournament.id,
          event_type: 'tournament_created',
          metadata: { name: json.tournament.name }
        }).then(() => {})
        setNewName('')
        setNewNotes('')
        setNewDeadline('')
        setCreateError('')
        loadTournaments()
        loadActivityLog()
      }
    } catch (err) {
      setCreateError(err.message || 'Network error — please try again')
    }
    setCreating(false)
  }

  function openSettings() {
    setSettingsDraft(JSON.parse(JSON.stringify(settings)))
    setSettingsOpen(true)
  }

  function saveSettings() {
    setSettings(settingsDraft)
    try { localStorage.setItem('ac_settings', JSON.stringify(settingsDraft)) } catch {}
    setSettingsOpen(false)
  }

  function updateDraftElement(key, field, value) {
    setSettingsDraft(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: field === 'duration' ? Number(value) : value }
    }))
  }

  // ── SEQUENCE BUILDER ─────────────────────────────────────────────────────

  function loadSeqConfigs(tournamentId) {
    try {
      const stored = localStorage.getItem(`ac_seqcfg_${tournamentId}`)
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  }

  function makeDefaultSeqConfig(n) {
    return {
      id: `seq-${Date.now()}-${n}`,
      name: `Main Content ${n}`,
      tournamentAdNames: [],
      lpgaAdNames: [],
      systemElements: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      templateId: null,
    }
  }

  async function openSeqBuilder(tournament) {
    setSeqBuilderTourn(tournament)
    setSeqBuilderLoading(true)
    setSeqBuilderOpen(true)
    const [{ data: lpgaAds }, { data: templates }] = await Promise.all([
      supabase
        .from('lpga_ads')
        .select('*')
        .eq('sequence_type', 'MainContent')
        .neq('is_active', false)
        .order('assigned_name', { ascending: true }),
      supabase
        .from('sequence_templates')
        .select('*')
        .order('name', { ascending: true }),
    ])
    const stored = loadSeqConfigs(tournament.id)
    const configs = stored.length > 0 ? stored : [makeDefaultSeqConfig(1)]
    setSeqBuilderLpgaAds(lpgaAds || [])
    setSeqBuilderTemplates(templates || [])
    setSeqBuilderConfigs(configs)
    setSeqExpandedIds(new Set(configs.map(c => c.id)))
    setSeqBuilderLoading(false)
  }

  function addSeqConfig() {
    const n = seqBuilderConfigs.length + 1
    const cfg = makeDefaultSeqConfig(n)
    setSeqBuilderConfigs(prev => [...prev, cfg])
    setSeqExpandedIds(prev => new Set([...prev, cfg.id]))
  }

  function deleteSeqConfig(id) {
    setSeqBuilderConfigs(prev => prev.filter(c => c.id !== id))
    setSeqExpandedIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  function toggleSeqExpand(id) {
    setSeqExpandedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function updateSeqName(id, name) {
    setSeqBuilderConfigs(prev => prev.map(c => c.id === id ? { ...c, name } : c))
  }

  function toggleTournAd(configId, adName) {
    setSeqBuilderConfigs(prev => prev.map(c => {
      if (c.id !== configId) return c
      const names = c.tournamentAdNames.includes(adName)
        ? c.tournamentAdNames.filter(n => n !== adName)
        : [...c.tournamentAdNames, adName]
      return { ...c, tournamentAdNames: names }
    }))
  }

  function toggleLpgaAd(configId, adName) {
    setSeqBuilderConfigs(prev => prev.map(c => {
      if (c.id !== configId) return c
      const names = c.lpgaAdNames.includes(adName)
        ? c.lpgaAdNames.filter(n => n !== adName)
        : [...c.lpgaAdNames, adName]
      return { ...c, lpgaAdNames: names }
    }))
  }

  function selectAllTournAds(configId) {
    const allNames = (seqBuilderTourn.uploads || [])
      .filter(u => u.sequence_type === 'MainContent')
      .map(u => u.assigned_name)
    setSeqBuilderConfigs(prev => prev.map(c => c.id === configId ? { ...c, tournamentAdNames: allNames } : c))
  }

  function selectAllLpgaAds(configId) {
    const allNames = seqBuilderLpgaAds.map(a => a.assigned_name)
    setSeqBuilderConfigs(prev => prev.map(c => c.id === configId ? { ...c, lpgaAdNames: allNames } : c))
  }

  function updateSeqTemplate(configId, templateId) {
    setSeqBuilderConfigs(prev => prev.map(c => c.id === configId ? { ...c, templateId: templateId || null } : c))
  }

  function updateSeqSysEl(configId, key, field, value) {
    setSeqBuilderConfigs(prev => prev.map(c => {
      if (c.id !== configId) return c
      return {
        ...c,
        systemElements: {
          ...c.systemElements,
          [key]: { ...c.systemElements[key], [field]: field === 'duration' ? Number(value) : value }
        }
      }
    }))
  }

  function saveSeqBuilderConfigs() {
    if (!seqBuilderTourn) return
    try {
      localStorage.setItem(`ac_seqcfg_${seqBuilderTourn.id}`, JSON.stringify(seqBuilderConfigs))
    } catch {}
    setSeqBuilderOpen(false)
  }

  function clearSeqConfigs(tournamentId) {
    try { localStorage.removeItem(`ac_seqcfg_${tournamentId}`) } catch {}
  }

  async function removeAllFiles(tournament) {
    if (!confirm(
      `⚠ Remove all ${(tournament.uploads || []).length} uploaded file${(tournament.uploads || []).length !== 1 ? 's' : ''} from "${tournament.name}"?\n\nThis permanently deletes every ad file for this tournament and cannot be undone.`
    )) return
    const res = await fetch(`/api/delete/tournament/${tournament.id}`, { method: 'DELETE' })
    if (res.ok) {
      loadTournaments()
      loadActivityLog()
    } else {
      const json = await res.json().catch(() => ({}))
      alert(`Failed to remove files: ${json.error || 'Unknown error'}`)
    }
  }

  async function toggleTournamentComplete(tournament) {
    const next = !tournament.is_complete
    await supabase.from('tournaments').update({ is_complete: next }).eq('id', tournament.id)
    loadTournaments()
  }

  async function deleteTournament(id) {
    if (!confirm('Delete this tournament and all its uploads?')) return
    await supabase.from('tournaments').delete().eq('id', id)
    loadTournaments()
    loadActivityLog()
  }

  function copyLink(token) {
    const url = `${window.location.origin}/upload/${token}`
    navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  async function exportJSON(tournament, type) {
    setExporting(`${tournament.id}-${type}`)
    const [{ data: uploads }, { data: lpgaAds }, { data: templates }] = await Promise.all([
      supabase.from('uploads').select('*').eq('tournament_id', tournament.id),
      supabase.from('lpga_ads').select('*').neq('is_active', false).order('assigned_name', { ascending: true }),
      supabase.from('sequence_templates').select('*'),
    ])
    const seqCfgs = loadSeqConfigs(tournament.id)
    const cfgArg  = seqCfgs.length > 0 ? seqCfgs : null
    const templatesById = Object.fromEntries((templates || []).map(t => [t.id, t]))
    const { generateElementsJSON, generateSequencesJSON } = await import('../../lib/generator')
    if (type === 'elements') {
      downloadJSON(generateElementsJSON(uploads || [], lpgaAds || [], settings), `${tournament.name}-elements.json`)
    } else if (type === 'sequences') {
      downloadJSON(generateSequencesJSON(uploads || [], lpgaAds || [], settings, cfgArg, templatesById), `${tournament.name}-sequences.json`)
    } else {
      downloadJSON(generateElementsJSON(uploads || [], lpgaAds || [], settings), `${tournament.name}-elements.json`)
      setTimeout(() => downloadJSON(generateSequencesJSON(uploads || [], lpgaAds || [], settings, cfgArg, templatesById), `${tournament.name}-sequences.json`), 400)
    }

    // Log the export
    const exportTypes = type === 'both' ? ['elements', 'sequences'] : [type]
    for (const et of exportTypes) {
      supabase.from('activity_log').insert({
        tournament_id: tournament.id,
        event_type: 'export',
        metadata: { export_type: et }
      }).then(() => {})
    }

    setExporting(null)
    setTimeout(loadActivityLog, 500)
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function openPreview(tournament) {
    setPreviewLoading(true)
    const [{ data: uploads }, { data: lpgaAds }, { data: templates }] = await Promise.all([
      supabase.from('uploads').select('*').eq('tournament_id', tournament.id),
      supabase.from('lpga_ads').select('*').neq('is_active', false).order('assigned_name', { ascending: true }),
      supabase.from('sequence_templates').select('*'),
    ])
    const seqCfgs = loadSeqConfigs(tournament.id)
    const templatesById = Object.fromEntries((templates || []).map(t => [t.id, t]))
    const { generateElementsJSON, generateSequencesJSON } = await import('../../lib/generator')
    const elements  = generateElementsJSON(uploads || [], lpgaAds || [], settings)
    const sequences = generateSequencesJSON(uploads || [], lpgaAds || [], settings, seqCfgs.length ? seqCfgs : null, templatesById)
    setPreview({ tournament, elements, sequences, tab: 'elements' })
    setPreviewLoading(false)
  }

  function triggerDownload(blobUrl, filename) {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
  }

  async function fetchFileBlob(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  }

  async function downloadSelected(tournament) {
    const ids = selectedFiles[tournament.id] || new Set()
    const uploads = (tournament.uploads || []).filter(u => ids.has(u.id))
    if (!uploads.length) return

    setDownloading(tournament.id)
    try {
      if (uploads.length === 1) {
        const u = uploads[0]
        const blob = await fetchFileBlob(u.file_url)
        const ext = u.original_filename.split('.').pop()
        triggerDownload(URL.createObjectURL(blob), `${u.assigned_name}.${ext}`)
      } else {
        const JSZip = (await import('jszip')).default
        const zip = new JSZip()
        const folder = zip.folder(tournament.name)
        const results = await Promise.allSettled(
          uploads.map(async u => {
            const blob = await fetchFileBlob(u.file_url)
            const ext = u.original_filename.split('.').pop()
            folder.file(`${u.assigned_name}.${ext}`, blob)
          })
        )
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed === uploads.length) throw new Error('All file fetches failed — check Supabase bucket CORS settings.')
        const content = await zip.generateAsync({ type: 'blob' })
        triggerDownload(URL.createObjectURL(content), `${tournament.name}.zip`)
      }
    } catch (err) {
      alert(`Download failed: ${err.message}`)
    } finally {
      setDownloading(null)
    }
  }

  function toggleFileSelect(tournId, uploadId) {
    setSelectedFiles(prev => {
      const set = new Set(prev[tournId] || [])
      if (set.has(uploadId)) set.delete(uploadId)
      else set.add(uploadId)
      return { ...prev, [tournId]: set }
    })
  }

  function selectAll(tournament) {
    const ids = new Set((tournament.uploads || []).map(u => u.id))
    setSelectedFiles(prev => ({ ...prev, [tournament.id]: ids }))
  }

  function deselectAll(tournId) {
    setSelectedFiles(prev => ({ ...prev, [tournId]: new Set() }))
  }

  // Reorders ads within one slot (drag-and-drop) without touching assigned_name —
  // persists the new play order to a separate sort_order column.
  function reorderUploads(tournamentId, sequenceType, fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    setTournaments(prev => prev.map(t => {
      if (t.id !== tournamentId) return t
      const slot = (t.uploads || []).filter(u => u.sequence_type === sequenceType).sort(bySortOrder)
      const rest = (t.uploads || []).filter(u => u.sequence_type !== sequenceType)
      const reordered = [...slot]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)
      const withOrder = reordered.map((u, i) => ({ ...u, sort_order: i }))
      Promise.all(
        withOrder.map(u => supabase.from('uploads').update({ sort_order: u.sort_order }).eq('id', u.id))
      ).then(() => {})
      return { ...t, uploads: [...rest, ...withOrder] }
    }))
  }

  function toggleExpand(id, uploads) {
    setExpanded(prev => {
      const willOpen = !prev[id]
      if (willOpen) {
        setSelectedFiles(sf => ({ ...sf, [id]: new Set((uploads || []).map(u => u.id)) }))
      }
      return { ...prev, [id]: willOpen }
    })
  }

  const filtered = tournaments.filter(t =>
    filter === 'all' ? true : getStatus(t.uploads, t.is_complete) === filter
  )

  const stats = {
    total:    tournaments.length,
    complete: tournaments.filter(t => getStatus(t.uploads, t.is_complete) === 'complete').length,
    progress: tournaments.filter(t => getStatus(t.uploads, t.is_complete) === 'progress').length,
    empty:    tournaments.filter(t => getStatus(t.uploads, t.is_complete) === 'empty').length,
    files:    tournaments.reduce((acc, t) => acc + (t.uploads || []).length, 0),
  }

  const filteredActivity = activityFilter === 'all'
    ? activityLog
    : activityLog.filter(e => e.event_type === activityFilter)

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
          <Link href="/admin/lpga" className={styles.headerLink}>🏌️ LPGA Ads</Link>
          <Link href="/admin/templates" className={styles.headerLink}>🧩 Templates</Link>
          <button className={styles.headerLink} onClick={openSettings} title="Sequence settings">⚙ Sequence Settings</button>
          <button className={styles.refreshBtn} onClick={() => { loadTournaments(); loadActivityLog() }} title="Refresh data">↻</button>
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
            <div className={styles.statLabel}>Tournaments</div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardComplete}`}>
            <div className={styles.statNum} style={{ color: '#166534' }}>{stats.complete}</div>
            <div className={styles.statLabel}>Complete</div>
            <div className={styles.statBar}>
              <div className={styles.statBarFill} style={{ width: stats.total ? `${(stats.complete / stats.total) * 100}%` : '0%', background: '#1a5c3a' }} />
            </div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardProgress}`}>
            <div className={styles.statNum} style={{ color: '#0369a1' }}>{stats.progress}</div>
            <div className={styles.statLabel}>In progress</div>
            <div className={styles.statBar}>
              <div className={styles.statBarFill} style={{ width: stats.total ? `${(stats.progress / stats.total) * 100}%` : '0%', background: '#0369a1' }} />
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
              <div className={styles.field} style={{ minWidth: 190, maxWidth: 220 }}>
                <label>Upload deadline (optional)</label>
                <input
                  type="datetime-local"
                  value={newDeadline}
                  onChange={e => setNewDeadline(e.target.value)}
                  className={styles.input}
                />
              </div>
              <button type="submit" className={styles.btnAccent} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
            {createError && (
              <div className={styles.createError}>⚠ {createError}</div>
            )}
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

        {/* Supabase connection error */}
        {loadError && (
          <div className={styles.loadErrorBanner}>
            <strong>⚠ Database unreachable</strong>
            <span>{loadError}</span>
            <button className={styles.btnGhost} onClick={() => { setLoadError(''); loadTournaments() }}>Retry</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <span>Loading tournaments…</span>
          </div>
        )}

        {/* Tournament cards */}
        {!loading && filtered.map(t => {
          const status     = getStatus(t.uploads, t.is_complete)
          const isOpen     = expanded[t.id]
          const totalFiles = (t.uploads || []).length
          const selSet     = selectedFiles[t.id] || new Set()
          const selCount   = selSet.size
          const markedComplete = !!t.is_complete
          const lateFiles  = (t.uploads || []).filter(u => u.is_late).length
          const isPastDeadline = t.deadline && new Date() > new Date(t.deadline)

          return (
            <div key={t.id} className={`${styles.tournCard} ${styles[`status_${status}`]}`}>

              {/* Card top */}
              <div className={styles.tournTop}>
                <div className={styles.tournLeft}>
                  <ProgressRing uploads={t.uploads} />
                  <div className={styles.tournInfo}>
                    <div className={styles.tournNameRow}>
                      <span className={styles.tournName}>{t.name}</span>
                      <StatusBadge status={status} />
                      {markedComplete && <span className={styles.completeBadge}>✓ Complete</span>}
                    </div>
                    {t.notes && <div className={styles.tournNotes}>{t.notes}</div>}
                    <div className={styles.tournMeta}>
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {totalFiles > 0 && <> · {totalFiles} file{totalFiles !== 1 ? 's' : ''}</>}
                      {lateFiles > 0 && <> · <span style={{ color: '#c2410c' }}>{lateFiles} late</span></>}
                      {t.deadline && <> · <span className={isPastDeadline ? styles.deadlinePast : styles.deadlineFuture}>
                        {isPastDeadline ? '⚠ past deadline' : `⏰ due ${fmtDeadline(t.deadline)}`}
                      </span></>}
                    </div>
                  </div>
                </div>
                <div className={styles.tournActions}>
                  <button className={styles.copyBtn} onClick={() => copyLink(t.upload_token)}>
                    {copied === t.upload_token ? '✓ Copied' : '🔗 Copy Link'}
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => openPreview(t)}
                    disabled={previewLoading || totalFiles === 0}
                    title="Preview JSON"
                  >
                    👁
                  </button>
                  <button
                    className={markedComplete ? styles.btnGhost : styles.btnComplete}
                    onClick={() => toggleTournamentComplete(t)}
                    title={markedComplete ? 'Unmark complete' : 'Mark complete'}
                  >
                    {markedComplete ? '↩ Unmark' : '✓ Complete'}
                  </button>
                  <button className={styles.iconBtnDanger} onClick={() => deleteTournament(t.id)} title="Delete tournament">✕</button>
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
                          background: filled ? s.color + '18' : 'transparent',
                          borderColor: filled ? s.color + '80' : undefined,
                        }}
                      >
                        <span style={{ color: filled ? s.color : '#adb5bd', fontSize: 10, fontWeight: 700 }}>
                          {s.short}
                        </span>
                      </div>
                      <div className={styles.slotCount} style={{ color: filled ? s.color : '#adb5bd' }}>
                        {filled ? `×${count}` : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* File gallery */}
              {isOpen && (
                <div className={styles.fileGallery}>
                  {totalFiles > 0 && (
                    <div className={styles.galleryToolbar}>
                      <button className={styles.selectAllBtn} onClick={() => selectAll(t)}>Select All</button>
                      <button className={styles.selectAllBtn} onClick={() => deselectAll(t.id)}>Deselect All</button>
                      <span className={styles.selectedCount}>{selCount} of {totalFiles} selected</span>
                      <button
                        className={selCount > 0 ? styles.btnDownload : styles.btnDownloadOff}
                        onClick={() => downloadSelected(t)}
                        disabled={downloading === t.id || selCount === 0}
                      >
                        {downloading === t.id ? '⏳ Downloading…' : `⬇ Download${selCount > 0 ? ` (${selCount})` : ''}`}
                      </button>
                    </div>
                  )}
                  {SLOTS.map(s => {
                    const slotUps = (t.uploads || []).filter(u => u.sequence_type === s.type).sort(bySortOrder)
                    if (slotUps.length === 0) return null
                    return (
                      <div key={s.type} className={styles.fileGallerySlot}>
                        <div className={styles.fileGallerySlotHeader}>
                          <span style={{ color: s.color }}>{s.label}</span>
                          <span className={styles.fileGroupDim}>{s.dim}</span>
                          <span className={styles.fileGroupDim}>· {slotUps.length} file{slotUps.length !== 1 ? 's' : ''}</span>
                          {slotUps.length > 1 && <span className={styles.fileGroupDim}>· drag ⠿ to reorder playback</span>}
                        </div>
                        <div className={styles.fileGalleryGrid}>
                          {slotUps.map((u, idx) => {
                            const isSel = selSet.has(u.id)
                            const dragKey = `${t.id}:${s.type}:${idx}`
                            return (
                              <div
                                key={u.id}
                                className={`${styles.fileGalleryCard} ${isSel ? styles.fileGalleryCardSelected : ''} ${dragOverCard === dragKey ? styles.fileGalleryCardDragOver : ''}`}
                                style={{ borderColor: isSel ? s.color : s.color + '40' }}
                                onClick={() => toggleFileSelect(t.id, u.id)}
                                onDragOver={e => e.preventDefault()}
                                onDragEnter={() => setDragOverCard(dragKey)}
                                onDragLeave={() => setDragOverCard(prev => (prev === dragKey ? null : prev))}
                                onDrop={e => {
                                  e.preventDefault()
                                  setDragOverCard(null)
                                  const drag = dragUploadRef.current
                                  if (!drag || drag.tournamentId !== t.id || drag.sequenceType !== s.type) return
                                  reorderUploads(t.id, s.type, drag.index, idx)
                                  dragUploadRef.current = null
                                }}
                              >
                                {slotUps.length > 1 && (
                                  <span
                                    className={styles.fileDragHandle}
                                    draggable
                                    onClick={e => e.stopPropagation()}
                                    onDragStart={e => {
                                      dragUploadRef.current = { tournamentId: t.id, sequenceType: s.type, index: idx }
                                      e.dataTransfer.setData('text/plain', u.id)
                                      e.dataTransfer.effectAllowed = 'move'
                                    }}
                                    title="Drag to reorder"
                                  >
                                    ⠿
                                  </span>
                                )}
                                <input
                                  type="checkbox"
                                  className={styles.fileCheckbox}
                                  checked={isSel}
                                  onChange={() => toggleFileSelect(t.id, u.id)}
                                  onClick={e => e.stopPropagation()}
                                />
                                <div className={styles.fileGalleryThumb}>
                                  {u.is_video
                                    ? <div className={styles.videoThumb}>▶</div>
                                    : <img src={u.file_url} alt={u.assigned_name} className={styles.fileGalleryImg} />
                                  }
                                </div>
                                <div className={styles.fileGalleryInfo}>
                                  <div className={styles.fileAssigned} style={{ color: s.color }}>
                                    {u.assigned_name}
                                    {u.is_late && <span className={styles.lateBadge}>Late</span>}
                                  </div>
                                  <div className={styles.fileOrig}>{u.original_filename}</div>
                                  <div className={styles.fileDims}>{u.width}×{u.height} · {Math.round((u.size_bytes || 0) / 1024)} KB</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {totalFiles === 0 && (
                    <div className={styles.fileMissing} style={{ textAlign: 'center', padding: '1rem' }}>No files uploaded yet.</div>
                  )}
                </div>
              )}

              {/* Export row */}
              <div className={styles.exportRow}>
                <div className={styles.exportJsonGroup}>
                  <span className={styles.exportLabel}>JSON</span>
                  <button className={styles.btnExport} onClick={() => exportJSON(t, 'elements')} disabled={!!exporting || totalFiles === 0}>
                    {exporting === `${t.id}-elements` ? '…' : 'elements.json'}
                  </button>
                  <button className={styles.btnExport} onClick={() => exportJSON(t, 'sequences')} disabled={!!exporting || totalFiles === 0}>
                    {exporting === `${t.id}-sequences` ? '…' : 'sequences.json'}
                  </button>
                  <button className={styles.btnAccentSm} onClick={() => exportJSON(t, 'both')} disabled={!!exporting || totalFiles === 0}>
                    {exporting === `${t.id}-both` ? '…' : '⬇ Export Both'}
                  </button>
                </div>
                <button className={styles.btnSeqBuilder} onClick={() => openSeqBuilder(t)}>
                  {(() => { const n = loadSeqConfigs(t.id).length; return n > 0 ? `📋 Sequences (${n})` : '📋 Build Sequences' })()}
                </button>
                <button
                  className={styles.btnViewFiles}
                  onClick={() => toggleExpand(t.id, t.uploads)}
                  disabled={totalFiles === 0}
                >
                  {isOpen ? '▲ Hide Files' : `▼ View Files${totalFiles > 0 ? ` (${totalFiles})` : ''}`}
                </button>
                <button
                  className={styles.btnRemoveAll}
                  onClick={() => removeAllFiles(t)}
                  disabled={totalFiles === 0}
                  title="Remove all uploaded files for this tournament"
                >
                  Remove All
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

        {/* Activity Log */}
        <div className={styles.activitySection}>
          <div className={styles.sectionHeader}>
            <button className={styles.activityToggle} onClick={() => setActivityOpen(o => !o)}>
              <span className={styles.sectionTitle}>Activity Log</span>
              <span className={styles.activityToggleChevron}>{activityOpen ? '▲' : '▼'}</span>
              {!activityOpen && activityLog.length > 0 && (
                <span className={styles.activityCount}>{activityLog.length}</span>
              )}
            </button>
            {activityOpen && <div className={styles.activityFilters}>
              {[
                { key: 'all',                label: 'All' },
                { key: 'upload',             label: 'Uploads' },
                { key: 'delete',             label: 'Deletes' },
                { key: 'export',             label: 'Exports' },
                { key: 'tournament_created', label: 'Created' },
              ].map(f => (
                <button
                  key={f.key}
                  className={`${styles.activityFilterBtn} ${activityFilter === f.key ? styles.activityFilterActive : ''}`}
                  onClick={() => setActivityFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>}
          </div>

          {activityOpen && <div className={styles.activityTableWrap}>
            {filteredActivity.length === 0 ? (
              <div className={styles.activityEmpty}>No activity yet.</div>
            ) : (
              <table className={styles.activityTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Tournament</th>
                    <th>File</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivity.map(e => (
                    <tr key={e.id}>
                      <td><span className={styles.activityTime}>{fmtTime(e.created_at)}</span></td>
                      <td>
                        <span className={`${styles.eventBadge} ${styles['event' + capitalize(e.event_type === 'tournament_created' ? 'Create' : e.event_type)]}`}>
                          {e.event_type === 'tournament_created' ? 'Created' : e.event_type}
                        </span>
                      </td>
                      <td><span className={styles.activityTourn}>{e.tournaments?.name || '—'}</span></td>
                      <td>
                        {e.assigned_name && (
                          <span className={styles.activityFile}>
                            {e.assigned_name}
                            {e.is_late && <span className={styles.lateBadge}>Late</span>}
                          </span>
                        )}
                        {!e.assigned_name && e.filename && (
                          <span className={styles.activityFile} style={{ color: 'var(--muted)' }}>{e.filename}</span>
                        )}
                        {!e.assigned_name && !e.filename && <span style={{ color: 'var(--border2)' }}>—</span>}
                      </td>
                      <td>
                        <span className={styles.activityMeta}>
                          {e.event_type === 'upload' && e.metadata?.size_bytes
                            ? `${Math.round(e.metadata.size_bytes / 1024)} KB · ${e.sequence_type || ''}`
                            : e.event_type === 'export'
                            ? e.metadata?.export_type
                            : e.event_type === 'tournament_created'
                            ? e.metadata?.name
                            : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>}
        </div>

      </div>

      {/* Sequence Builder Modal */}
      {seqBuilderOpen && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setSeqBuilderOpen(false)}>
          <div className={styles.modal} style={{ maxWidth: 760, width: '96vw' }}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>📋 Sequence Builder — {seqBuilderTourn?.name}</div>
                <div className={styles.modalSub}>Create multiple named Main Content sequences, each with its own ad selection and system elements. Right Rail, Header, and Ticker are auto-generated and unaffected.</div>
              </div>
              <button className={styles.modalClose} onClick={() => setSeqBuilderOpen(false)}>×</button>
            </div>

            <div className={styles.seqBuilderBody}>
              {seqBuilderLoading ? (
                <div className={styles.seqBuilderLoading}><div className={styles.spinner} /> Loading…</div>
              ) : (
                <>
                  {seqBuilderConfigs.length === 0 && (
                    <div className={styles.seqBuilderEmpty}>No sequences yet. Click "+ Add Sequence" below to get started.</div>
                  )}

                  {seqBuilderConfigs.map((cfg, cfgIdx) => {
                    const isExpanded = seqExpandedIds.has(cfg.id)
                    const tournMcAds = (seqBuilderTourn?.uploads || []).filter(u => u.sequence_type === 'MainContent').sort(bySortOrder)
                    return (
                      <div key={cfg.id} className={styles.seqCard}>
                        {/* Sequence card header */}
                        <div className={styles.seqCardHeader}>
                          <button className={styles.seqExpandBtn} onClick={() => toggleSeqExpand(cfg.id)}>
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <input
                            className={styles.seqNameInput}
                            value={cfg.name}
                            onChange={e => updateSeqName(cfg.id, e.target.value)}
                            placeholder="Sequence name"
                          />
                          <span className={styles.seqCardMeta}>
                            {cfg.tournamentAdNames.length} tourn · {cfg.lpgaAdNames.length} LPGA
                          </span>
                          <button className={styles.seqDeleteBtn} onClick={() => deleteSeqConfig(cfg.id)} title="Remove this sequence">✕</button>
                        </div>

                        {isExpanded && (
                          <div className={styles.seqCardBody}>

                            {/* Rotation Template */}
                            <div className={styles.seqSection}>
                              <div className={styles.seqSectionHeader}>
                                <span className={styles.seqSectionTitle}>Rotation Template</span>
                              </div>
                              <select
                                className={styles.seqTemplateSelect}
                                value={cfg.templateId || ''}
                                onChange={e => updateSeqTemplate(cfg.id, e.target.value)}
                              >
                                <option value="">Default pattern (Tournament × 2 · LPGA · alternating Scorecards/Next On Green)</option>
                                {seqBuilderTemplates.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                              {seqBuilderTemplates.length === 0 && (
                                <div className={styles.seqNoAds}>No saved templates yet — build one on the <Link href="/admin/templates">Templates</Link> page.</div>
                              )}
                            </div>

                            {/* Tournament MC Ads */}
                            <div className={styles.seqSection}>
                              <div className={styles.seqSectionHeader}>
                                <span className={styles.seqSectionTitle}>Tournament Ads</span>
                                <button className={styles.seqSelectAllBtn} onClick={() => selectAllTournAds(cfg.id)}>All</button>
                                <button className={styles.seqSelectAllBtn} onClick={() => setSeqBuilderConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, tournamentAdNames: [] } : c))}>None</button>
                              </div>
                              {tournMcAds.length === 0 ? (
                                <div className={styles.seqNoAds}>No Main Content ads uploaded yet for this tournament.</div>
                              ) : (
                                <div className={styles.seqAdGrid}>
                                  {tournMcAds.map(u => (
                                    <label key={u.id} className={`${styles.seqAdItem} ${cfg.tournamentAdNames.includes(u.assigned_name) ? styles.seqAdItemOn : ''}`}>
                                      <input
                                        type="checkbox"
                                        checked={cfg.tournamentAdNames.includes(u.assigned_name)}
                                        onChange={() => toggleTournAd(cfg.id, u.assigned_name)}
                                      />
                                      <span className={styles.seqAdName}>{u.assigned_name}</span>
                                      {u.is_video && <span className={styles.seqAdBadge}>VID</span>}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* LPGA MC Ads */}
                            <div className={styles.seqSection}>
                              <div className={styles.seqSectionHeader}>
                                <span className={styles.seqSectionTitle}>LPGA Ads</span>
                                <button className={styles.seqSelectAllBtn} onClick={() => selectAllLpgaAds(cfg.id)}>All</button>
                                <button className={styles.seqSelectAllBtn} onClick={() => setSeqBuilderConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, lpgaAdNames: [] } : c))}>None</button>
                              </div>
                              {seqBuilderLpgaAds.length === 0 ? (
                                <div className={styles.seqNoAds}>No active LPGA Main Content ads.</div>
                              ) : (
                                <div className={styles.seqAdGrid}>
                                  {seqBuilderLpgaAds.map(a => (
                                    <label key={a.id} className={`${styles.seqAdItem} ${cfg.lpgaAdNames.includes(a.assigned_name) ? styles.seqAdItemOn : ''}`}>
                                      <input
                                        type="checkbox"
                                        checked={cfg.lpgaAdNames.includes(a.assigned_name)}
                                        onChange={() => toggleLpgaAd(cfg.id, a.assigned_name)}
                                      />
                                      <span className={styles.seqAdName}>{a.assigned_name}</span>
                                      {a.is_video && <span className={styles.seqAdBadge}>VID</span>}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* System Elements */}
                            <div className={styles.seqSection}>
                              <div className={styles.seqSectionHeader}>
                                <span className={styles.seqSectionTitle}>System Elements</span>
                              </div>
                              <div className={styles.seqSysGrid}>
                                {SYSTEM_ELEMENT_INFO.map(el => {
                                  const elCfg = cfg.systemElements?.[el.key] || {}
                                  return (
                                    <div key={el.key} className={`${styles.seqSysRow} ${elCfg.enabled ? styles.seqSysRowOn : ''}`}>
                                      <label className={styles.seqSysCheck}>
                                        <input
                                          type="checkbox"
                                          checked={!!elCfg.enabled}
                                          onChange={e => updateSeqSysEl(cfg.id, el.key, 'enabled', e.target.checked)}
                                        />
                                        <span>{el.label}</span>
                                      </label>
                                      <input
                                        type="number"
                                        min="1"
                                        max="300"
                                        value={elCfg.duration ?? ''}
                                        onChange={e => updateSeqSysEl(cfg.id, el.key, 'duration', e.target.value)}
                                        disabled={!elCfg.enabled}
                                        className={styles.seqSysDur}
                                        title="Duration in seconds"
                                      />
                                      <span className={styles.seqSysDurLabel}>s</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>

                          </div>
                        )}
                      </div>
                    )
                  })}

                  <button className={styles.seqAddBtn} onClick={addSeqConfig}>+ Add Sequence</button>
                </>
              )}
            </div>

            <div className={styles.modalFooter}>
              <span className={styles.modalFooterNote}>
                {seqBuilderConfigs.length} sequence{seqBuilderConfigs.length !== 1 ? 's' : ''} configured · saved per tournament in your browser
              </span>
              <button className={styles.btnGhost} onClick={() => setSeqBuilderOpen(false)}>Cancel</button>
              {seqBuilderConfigs.length === 0 && (
                <button className={styles.btnGhost} onClick={() => { clearSeqConfigs(seqBuilderTourn?.id); setSeqBuilderOpen(false) }}>
                  Use Default
                </button>
              )}
              <button className={styles.btnAccent} onClick={saveSeqBuilderConfigs}>Save Sequences</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setSettingsOpen(false)}>
          <div className={styles.modal} style={{ maxWidth: 560 }}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>⚙ Sequence Settings</div>
                <div className={styles.modalSub}>Choose which system elements appear in the Main Content sequence after each ad cycle.</div>
              </div>
              <button className={styles.modalClose} onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.settingsGrid}>
                {SYSTEM_ELEMENT_INFO.map(el => {
                  const draft = settingsDraft[el.key] || {}
                  return (
                    <div key={el.key} className={`${styles.settingsRow} ${draft.enabled ? styles.settingsRowOn : styles.settingsRowOff}`}>
                      <label className={styles.settingsCheck}>
                        <input
                          type="checkbox"
                          checked={!!draft.enabled}
                          onChange={e => updateDraftElement(el.key, 'enabled', e.target.checked)}
                        />
                        <span className={styles.settingsLabel}>{el.label}</span>
                      </label>
                      <span className={styles.settingsDesc}>{el.desc}</span>
                      <div className={styles.settingsDur}>
                        <label className={styles.settingsDurLabel}>Duration (s)</label>
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={draft.duration ?? ''}
                          onChange={e => updateDraftElement(el.key, 'duration', e.target.value)}
                          disabled={!draft.enabled}
                          className={styles.settingsDurInput}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className={styles.settingsNote}>
                Settings apply to all JSON exports from this browser. Disabled elements are excluded from both elements.json and sequences.json.
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button
                className={styles.btnGhost}
                onClick={() => {
                  setSettingsDraft(DEFAULT_SETTINGS)
                }}
              >
                Reset to Defaults
              </button>
              <button className={styles.btnAccent} onClick={saveSettings}>Save Settings</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setPreview(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>JSON Preview — {preview.tournament.name}</div>
                <div className={styles.modalSub}>This is what will be exported to your video board software.</div>
              </div>
              <button className={styles.modalClose} onClick={() => setPreview(null)}>×</button>
            </div>
            <div className={styles.modalTabs}>
              <button
                className={`${styles.modalTab} ${preview.tab === 'elements' ? styles.modalTabActive : ''}`}
                onClick={() => setPreview(p => ({ ...p, tab: 'elements' }))}
              >
                elements.json ({preview.elements.length} items)
              </button>
              <button
                className={`${styles.modalTab} ${preview.tab === 'sequences' ? styles.modalTabActive : ''}`}
                onClick={() => setPreview(p => ({ ...p, tab: 'sequences' }))}
              >
                sequences.json ({preview.sequences.length} sequences)
              </button>
            </div>
            <div className={styles.modalBody}>
              <pre className={styles.previewJsonWrap}>
                {JSON.stringify(preview.tab === 'elements' ? preview.elements : preview.sequences, null, 2)}
              </pre>
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalFooterNote}>
                {preview.tab === 'elements' ? preview.elements.length : preview.sequences.length} {preview.tab === 'elements' ? 'elements' : 'sequences'} · read-only preview
              </span>
              <button className={styles.btnGhost} onClick={() => setPreview(null)}>Close</button>
              <button
                className={styles.btnExport}
                onClick={() => downloadJSON(preview.tab === 'elements' ? preview.elements : preview.sequences, `${preview.tournament.name}-${preview.tab}.json`)}
              >
                ⬇ Download {preview.tab}.json
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
