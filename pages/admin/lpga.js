import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import styles from './lpga.module.css'

const SLOTS = [
  { type: 'MainContent', label: 'Main Content', color: '#1a5c3a', dim: '960×540' },
  { type: 'RightRail',   label: 'Right Rail',   color: '#0369a1', dim: '320×540' },
  { type: 'Header',      label: 'Header',        color: '#b45309', dim: '1280×120' },
  { type: 'Ticker',      label: 'Ticker',        color: '#7c3aed', dim: '1280×60' },
]

export default function LpgaAds() {
  const [authed, setAuthed]       = useState(false)
  const [password, setPassword]   = useState('')
  const [authError, setAuthError] = useState('')
  const [ads, setAds]             = useState([])
  const [loading, setLoading]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState([])
  const [dragging, setDragging]   = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    const saved = sessionStorage.getItem('ac_admin')
    if (saved === 'true') { setAuthed(true); loadAds() }
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
      loadAds()
    } else {
      setAuthError('Incorrect password')
    }
  }

  async function loadAds() {
    setLoading(true)
    const res = await fetch('/api/lpga/list')
    if (res.ok) {
      const data = await res.json()
      setAds(data.ads || [])
    }
    setLoading(false)
  }

  async function handleFiles(files) {
    if (!files || !files.length) return
    setUploading(true)

    const fileArr = Array.from(files)
    const prog = fileArr.map(f => ({ name: f.name, status: 'pending' }))
    setProgress(prog)

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      const updProg = [...prog]
      updProg[i] = { ...updProg[i], status: 'uploading' }
      setProgress([...updProg])

      try {
        const formData = new FormData()
        formData.append('file', file)

        let extraQuery = ''
        const isVid = /\.(wmv|mp4|mov|avi|mpg|mpeg)$/i.test(file.name)
        if (isVid) {
          const dims = await getVideoDimensions(file).catch(() => null)
          if (dims) extraQuery = `?width=${dims.width}&height=${dims.height}`
        }

        const res = await fetch(`/api/lpga/upload${extraQuery}`, {
          method: 'POST',
          body: formData
        })

        const json = await res.json()
        if (!res.ok) {
          updProg[i] = { ...updProg[i], status: 'error', message: json.error }
        } else {
          updProg[i] = { ...updProg[i], status: 'done', ad: json.ad }
        }
        setProgress([...updProg])
      } catch (err) {
        updProg[i] = { ...updProg[i], status: 'error', message: err.message }
        setProgress([...updProg])
      }
    }

    setUploading(false)
    await loadAds()
    setTimeout(() => setProgress([]), 5000)
  }

  function getVideoDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight }); URL.revokeObjectURL(url) }
      video.onerror = reject
      video.src = url
    })
  }

  async function toggleActive(ad) {
    await fetch(`/api/lpga/toggle/${ad.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !ad.is_active })
    })
    setAds(prev => prev.map(a => a.id === ad.id ? { ...a, is_active: !a.is_active } : a))
  }

  async function deleteAd(ad) {
    if (!confirm(`Delete ${ad.assigned_name}? This cannot be undone.`)) return
    await fetch(`/api/lpga/delete/${ad.id}`, { method: 'DELETE' })
    setAds(prev => prev.filter(a => a.id !== ad.id))
  }

  function onDragOver(e) { e.preventDefault(); setDragging(true) }
  function onDragLeave()  { setDragging(false) }
  function onDrop(e) { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }

  const adsFor = type => ads.filter(a => a.sequence_type === type)
  const activeCount = ads.filter(a => a.is_active).length

  // ── LOGIN ──
  if (!authed) return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <div className={styles.loginLogo}>
          <span>⛳</span>
          <span className={styles.logoText} style={{ color: 'var(--accent)' }}>AdCaddie</span>
        </div>
        <div className={styles.loginSub}>Admin Portal — LPGA Ads</div>
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
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoMark}>⛳</span>
          <span className={styles.logoText}>AdCaddie</span>
          <span className={styles.headerSub}>LPGA Ads</span>
        </div>
        <div className={styles.headerRight}>
          <Link href="/admin" className={styles.backBtn}>← Admin Dashboard</Link>
        </div>
      </header>

      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>LPGA / Corporate Ads</div>
          <div className={styles.pageSub}>
            These ads are assigned the <strong>C- prefix</strong> and are included in every tournament export. Toggle them on/off to control which appear in sequences.
          </div>
        </div>

        {/* Upload card */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>+ Upload LPGA Ads</div>
          <div
            className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${uploading ? styles.uploadingZone : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => !uploading && fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.wmv,.mp4,.mov"
              style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
            {uploading ? (
              <div className={styles.dzUploading}>
                <div className={styles.spinner} />
                <div className={styles.dzLabel}>Uploading…</div>
              </div>
            ) : (
              <>
                <div className={styles.dzIcon}>🏌️</div>
                <div className={styles.dzLabel}><strong>Drop LPGA ad files here</strong><br />or click to browse</div>
                <div className={styles.dzSub}>JPG · PNG · WebP · MP4 · WMV · MOV</div>
              </>
            )}
          </div>

          {progress.length > 0 && (
            <div className={styles.progressList}>
              {progress.map((p, i) => (
                <div key={i} className={styles.progressItem}>
                  <span className={styles.progressIcon}>
                    {p.status === 'pending' ? '⏳' : p.status === 'uploading' ? '⏫' : p.status === 'done' ? '✓' : '✗'}
                  </span>
                  <span className={styles.progressName}>{p.name}</span>
                  {p.status === 'done' && p.ad && <span className={styles.progressOk}>→ {p.ad.assigned_name} ({p.ad.sequence_type})</span>}
                  {p.status === 'error' && <span className={styles.progressErr}>{p.message}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats row */}
        {!loading && ads.length > 0 && (
          <div className={styles.statsRow}>
            <div className={styles.statPill}><strong>{ads.length}</strong> total ads</div>
            <div className={styles.statPill}><strong>{activeCount}</strong> active</div>
            <div className={styles.statPill}><strong>{ads.length - activeCount}</strong> inactive</div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <span>Loading LPGA ads…</span>
          </div>
        )}

        {/* Ads by slot */}
        {!loading && SLOTS.map(slot => {
          const slotAds = adsFor(slot.type)
          return (
            <div key={slot.type} className={styles.slotSection}>
              <div className={styles.slotHeader}>
                <div className={styles.slotTitle} style={{ color: slot.color }}>
                  {slot.label}
                  <span className={styles.slotDim}>{slot.dim}</span>
                </div>
                <span className={styles.slotCount}>{slotAds.length} ad{slotAds.length !== 1 ? 's' : ''}</span>
              </div>

              {slotAds.length === 0 ? (
                <div className={styles.slotEmpty}>No {slot.label} ads uploaded yet.</div>
              ) : (
                <div className={styles.adGrid}>
                  {slotAds.map(ad => (
                    <div key={ad.id} className={`${styles.adCard} ${!ad.is_active ? styles.adCardInactive : ''}`}>
                      <div className={styles.adThumb}>
                        {ad.is_video ? (
                          <div className={styles.videoThumb}>🎬</div>
                        ) : (
                          <img src={ad.file_url} alt={ad.assigned_name} className={styles.thumbImg} />
                        )}
                      </div>
                      <div className={styles.adInfo}>
                        <div className={styles.adName}>{ad.assigned_name}</div>
                        <div className={styles.adOrig}>{ad.original_filename || '—'}</div>
                        <div className={styles.adMeta}>
                          {ad.width}×{ad.height} · {ad.is_video ? 'Video' : 'Image'} · {Math.round((ad.size_bytes || 0) / 1024)} KB
                        </div>
                      </div>
                      <div className={styles.adActions}>
                        <button
                          className={`${styles.toggleBtn} ${ad.is_active ? styles.toggleActive : styles.toggleInactive}`}
                          onClick={() => toggleActive(ad)}
                        >
                          {ad.is_active ? '✓ Active' : 'Inactive'}
                        </button>
                        <button className={styles.deleteBtn} onClick={() => deleteAd(ad)} title="Delete">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {!loading && ads.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--muted)', fontSize: 14 }}>
            No LPGA ads uploaded yet. Drop files above to get started.
          </div>
        )}
      </div>
    </div>
  )
}
