import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import styles from './templates.module.css'

// Draggable block types. `type`/`systemKey` match the shape lib/generator.js's
// buildMCStepsFromTemplate() expects on each block in a template's cycles.
const BLOCK_TYPES = [
  { key: 'tournament_ad',    type: 'tournament_ad', label: 'Tournament Ad',  fg: '#93691a', bg: '#f3e6c3', line: '#d9b767' },
  { key: 'lpga_ad',          type: 'lpga_ad',        label: 'LPGA Ad',        fg: '#1f6b63', bg: '#dcece8', line: '#79b3a8' },
  { key: 'system:_SC',       type: 'system', systemKey: '_SC',      label: 'Scorecards',    defaultDuration: 24, fg: '#3f5f82', bg: '#dfe7f0', line: '#8faed0' },
  { key: 'system:_LB',       type: 'system', systemKey: '_LB',      label: 'Leaderboard',   defaultDuration: 30, fg: '#ab3a24', bg: '#f4ded7', line: '#d98d75' },
  { key: 'system:_ProjCut',  type: 'system', systemKey: '_ProjCut', label: 'Projected Cut', defaultDuration: 10, fg: '#5c4d82', bg: '#e5e0f0', line: '#a897cf' },
  { key: 'system:_NOG',      type: 'system', systemKey: '_NOG',     label: 'Next On Green', defaultDuration: 10, fg: '#3f6b34', bg: '#dfead6', line: '#8bb578' },
]

function typeInfoFor(block) {
  const key = block.type === 'system' ? `system:${block.systemKey}` : block.type
  return BLOCK_TYPES.find(bt => bt.key === key) || BLOCK_TYPES[0]
}

function cycleDuration(cycle) {
  return (cycle || []).reduce((sum, b) => {
    if (b.type === 'system') {
      const info = typeInfoFor(b)
      return sum + (b.duration ?? info.defaultDuration ?? 0)
    }
    return sum + 8 // ads: actual duration is resolved per-ad at export time — 8s is a rough placeholder
  }, 0)
}

let blockIdCounter = 0
function makeBlock(blockType) {
  blockIdCounter += 1
  const block = { id: `b${Date.now()}${blockIdCounter}`, type: blockType.type }
  if (blockType.type === 'system') block.systemKey = blockType.systemKey
  return block
}

function cycleLetter(i) { return String.fromCharCode(65 + i) }

function BlockChip({ block, mini, draggable, onDragStart, onDragOver, onDrop, onRemove, onDurationChange }) {
  const info = typeInfoFor(block)
  const style = { '--c-fg': info.fg, '--c-bg': info.bg, '--c-line': info.line }
  return (
    <span
      className={`${styles.chip} ${mini ? styles.chipMini : styles.blockChip}`}
      style={style}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {info.label}
      {!mini && block.type === 'system' && (
        <input
          type="number"
          min="1"
          max="300"
          className={styles.blockDur}
          value={block.duration ?? info.defaultDuration}
          onClick={e => e.stopPropagation()}
          onChange={e => onDurationChange(e.target.value)}
          title="Duration in seconds"
        />
      )}
      {!mini && (
        <button className={styles.blockRemove} onClick={onRemove} title="Remove">✕</button>
      )}
    </span>
  )
}

export default function Templates() {
  const [authed, setAuthed]       = useState(false)
  const [password, setPassword]   = useState('')
  const [authError, setAuthError] = useState('')
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(false)
  const [loaded, setLoaded]       = useState(false)
  const [newName, setNewName]     = useState('')
  const [creating, setCreating]   = useState(false)
  const [editing, setEditing]     = useState(null) // { id, name, cycles }
  const [saving, setSaving]       = useState(false)
  const [overCycle, setOverCycle] = useState(null)
  const dragRef = useRef(null)

  useEffect(() => {
    const saved = sessionStorage.getItem('ac_admin')
    if (saved === 'true') { setAuthed(true); loadTemplates() }
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
      loadTemplates()
    } else {
      setAuthError('Incorrect password')
    }
  }

  async function loadTemplates() {
    setLoading(true)
    const { data, error } = await supabase.from('sequence_templates').select('*').order('name', { ascending: true })
    if (!error) setTemplates(data || [])
    setLoading(false)
    setLoaded(true)
  }

  async function createTemplate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('sequence_templates')
      .insert({ name: newName.trim(), cycles: [[]] })
      .select()
      .single()
    setCreating(false)
    if (error) { alert(`Failed to create template: ${error.message}`); return }
    setNewName('')
    setTemplates(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    openEditor(data)
  }

  function openEditor(tmpl) {
    const cycles = Array.isArray(tmpl.cycles) && tmpl.cycles.length > 0 ? tmpl.cycles : [[]]
    setEditing({ id: tmpl.id, name: tmpl.name, cycles: cycles.map(c => [...c]) })
  }

  function closeEditor() { setEditing(null) }

  async function deleteTemplate(tmpl) {
    if (!confirm(`Delete template "${tmpl.name}"? Sequences currently using it will fall back to the default rotation pattern.`)) return
    const { error } = await supabase.from('sequence_templates').delete().eq('id', tmpl.id)
    if (error) { alert(`Failed to delete: ${error.message}`); return }
    setTemplates(prev => prev.filter(t => t.id !== tmpl.id))
  }

  async function saveEditor() {
    if (!editing) return
    setSaving(true)
    const cleanCycles = editing.cycles.filter(c => c.length > 0)
    const { data, error } = await supabase
      .from('sequence_templates')
      .update({ name: editing.name.trim() || 'Untitled Template', cycles: cleanCycles.length ? cleanCycles : [[]] })
      .eq('id', editing.id)
      .select()
      .single()
    setSaving(false)
    if (error) { alert(`Failed to save: ${error.message}`); return }
    setTemplates(prev => prev.map(t => t.id === data.id ? data : t).sort((a, b) => a.name.localeCompare(b.name)))
    setEditing(null)
  }

  function addCycle() {
    setEditing(e => ({ ...e, cycles: [...e.cycles, []] }))
  }
  function removeCycle(ci) {
    setEditing(e => ({ ...e, cycles: e.cycles.filter((_, i) => i !== ci) }))
  }
  function removeBlock(ci, bi) {
    setEditing(e => {
      const cycles = e.cycles.map(c => [...c])
      cycles[ci].splice(bi, 1)
      return { ...e, cycles }
    })
  }
  function updateBlockDuration(ci, bi, value) {
    setEditing(e => {
      const cycles = e.cycles.map(c => [...c])
      const num = value === '' ? undefined : Number(value)
      cycles[ci][bi] = { ...cycles[ci][bi], duration: num }
      return { ...e, cycles }
    })
  }

  function performDrop(evt, cycleIndex, insertAt) {
    evt.preventDefault()
    const drag = dragRef.current
    setOverCycle(null)
    if (!drag) return
    setEditing(prev => {
      if (!prev) return prev
      const cycles = prev.cycles.map(c => [...c])
      let newBlock
      let at = insertAt
      if (drag.source === 'palette') {
        newBlock = makeBlock(drag.blockType)
      } else {
        const [removed] = cycles[drag.cycleIndex].splice(drag.blockIndex, 1)
        newBlock = removed
        if (drag.cycleIndex === cycleIndex && at != null && drag.blockIndex < at) at -= 1
      }
      const target = cycles[cycleIndex]
      target.splice(at == null ? target.length : at, 0, newBlock)
      return { ...prev, cycles }
    })
    dragRef.current = null
  }

  // ── LOGIN ──
  if (!authed) return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <div className={styles.loginLogo}>
          <span>⛳</span>
          <span className={styles.logoText} style={{ color: 'var(--tmpl)' }}>AdCaddie</span>
        </div>
        <div className={styles.loginSub}>Admin Portal — Sequence Templates</div>
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

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoMark}>⛳</span>
          <span className={styles.logoText}>AdCaddie</span>
          <span className={styles.headerSub}>Templates</span>
        </div>
        <div className={styles.headerRight}>
          <Link href="/admin" className={styles.backBtn}>← Admin Dashboard</Link>
        </div>
      </header>

      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>🧩 Sequence Templates</div>
          <div className={styles.pageSub}>
            Design reusable MainContent rotation patterns by dragging blocks into cycles. Apply a template to any tournament's
            sequence from its Sequence Builder — the template controls the order, the sequence still controls which ads are included.
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>+ New Template</div>
          <form className={styles.newForm} onSubmit={createTemplate}>
            <input
              type="text"
              placeholder="e.g. Standard Rotation, Sponsor Heavy…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className={styles.newInput}
            />
            <button type="submit" className={styles.newBtn} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>

        {loading && (
          <div className={styles.loadingWrap}><div className={styles.spinner} /> Loading templates…</div>
        )}

        {!loading && loaded && templates.length === 0 && (
          <div className={styles.tmplEmpty}>No templates yet. Create one above to get started.</div>
        )}

        {!loading && templates.length > 0 && (
          <div className={styles.tmplGrid}>
            {templates.map(tmpl => (
              <div key={tmpl.id} className={styles.tmplCard}>
                <div className={styles.tmplCardTop}>
                  <div className={styles.tmplName}>{tmpl.name}</div>
                  <div className={styles.tmplActions}>
                    <button className={styles.tmplEditBtn} onClick={() => openEditor(tmpl)}>Edit</button>
                    <button className={styles.tmplDeleteBtn} onClick={() => deleteTemplate(tmpl)}>Delete</button>
                  </div>
                </div>
                <div className={styles.tmplPreview}>
                  {(tmpl.cycles || []).map((cycle, ci) => (
                    <div key={ci} className={styles.tmplPreviewRow}>
                      <span className={styles.tmplPreviewLabel}>{cycleLetter(ci)}</span>
                      {cycle.length === 0
                        ? <span className={styles.dropzoneEmpty}>empty</span>
                        : cycle.map((b, bi) => <BlockChip key={bi} block={b} mini />)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editing && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && closeEditor()}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <input
                  className={styles.modalTitleInput}
                  value={editing.name}
                  onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
                />
                <div className={styles.modalSub}>
                  Drag block types from the palette into a cycle. Cycles A → B → C… play in order, then loop back to A.
                </div>
              </div>
              <button className={styles.modalClose} onClick={closeEditor}>×</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.paletteLabel}>Palette — drag into a cycle below</div>
              <div className={styles.palette}>
                {BLOCK_TYPES.map(bt => (
                  <span
                    key={bt.key}
                    className={`${styles.chip} ${styles.paletteChip}`}
                    style={{ '--c-fg': bt.fg, '--c-bg': bt.bg, '--c-line': bt.line }}
                    draggable
                    onDragStart={e => {
                      dragRef.current = { source: 'palette', blockType: bt }
                      e.dataTransfer.setData('text/plain', bt.key)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    {bt.label}
                  </span>
                ))}
              </div>

              {editing.cycles.map((cycle, ci) => (
                <div key={ci} className={styles.cycleRow}>
                  <div className={styles.cycleHead}>
                    <span className={styles.cycleLetter}>{cycleLetter(ci)}</span>
                    <span className={styles.cycleName}>Cycle {cycleLetter(ci)}</span>
                    <span className={styles.cycleDur}>~{cycleDuration(cycle)}s</span>
                    <button
                      className={styles.cycleRemoveBtn}
                      onClick={() => removeCycle(ci)}
                      disabled={editing.cycles.length <= 1}
                      title="Remove cycle"
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    className={`${styles.dropzone} ${overCycle === ci ? styles.dropzoneOver : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDragEnter={() => setOverCycle(ci)}
                    onDragLeave={() => setOverCycle(prev => (prev === ci ? null : prev))}
                    onDrop={e => performDrop(e, ci, null)}
                  >
                    {cycle.length === 0 && <span className={styles.dropzoneEmpty}>Drop blocks here…</span>}
                    {cycle.map((block, bi) => (
                      <BlockChip
                        key={block.id}
                        block={block}
                        draggable
                        onDragStart={e => {
                          dragRef.current = { source: 'cycle', cycleIndex: ci, blockIndex: bi }
                          e.dataTransfer.setData('text/plain', 'move')
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                        onDrop={e => { e.stopPropagation(); performDrop(e, ci, bi) }}
                        onRemove={() => removeBlock(ci, bi)}
                        onDurationChange={val => updateBlockDuration(ci, bi, val)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <button className={styles.addCycleBtn} onClick={addCycle}>+ Add Cycle</button>
            </div>

            <div className={styles.modalFooter}>
              <span className={styles.modalFooterNote}>
                {editing.cycles.filter(c => c.length > 0).length} cycle{editing.cycles.filter(c => c.length > 0).length !== 1 ? 's' : ''} configured
              </span>
              <button className={styles.btnGhost} onClick={closeEditor}>Cancel</button>
              <button className={styles.btnAccent} onClick={saveEditor} disabled={saving}>
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
