import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
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
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef()
  const videoFileRef = useRef()
  const [videoItems, setVideoItems] = useState([])
  const [videoUploading, setVideoUploading] = useState(false)

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

        const res = await fetch('/api/lpga/upload', { method: 'POST', body: formData })
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

  function addVideoFiles(files) {
    if (!files || !files.length) return
    const next = Array.from(files).map(f => ({ file: f, duration: '', status: 'pending', assignedName: null, message: '' }))
    setVideoItems(prev => [...prev, ...next])
    if (videoFileRef.current) videoFileRef.current.value = ''
  }

  function updateVideoDuration(index, value) {
    setVideoItems(prev => prev.map((it, i) => i === index ? { ...it, duration: value } : it))
  }

  function removeVideoItem(index) {
    setVideoItems(prev => prev.filter((_, i) => i !== index))
  }

  async function handleVideoUpload() {
    if (videoUploading) return
    setVideoUploading(true)

    for (let idx = 0; idx < videoItems.length; idx++) {
      const item = videoItems[idx]
      if (item.status !== 'pending') continue
      const duration = parseInt(item.duration)
      if (!duration || duration < 1) continue

      setVideoItems(prev => prev.map((it, i) => i === idx ? { ...it, status: 'uploading' } : it))

      try {
        // Step 1: get signed upload URL (no file sent to server)
        const signRes = await fetch(
          `/api/lpga/video?filename=${encodeURIComponent(item.file.name)}&duration=${duration}&width=960&height=540&size=${item.file.size}`
        )
        const signJson = await signRes.json()
        if (!signRes.ok) throw new Error(signJson.error)

        const { assignedName, filePath, uploadToken, sequenceType, width, height } = signJson

        // Step 2: upload directly to Supabase Storage (bypasses Vercel size limit)
        const { error: storageErr } = await supabase.storage
          .from('ads')
          .uploadToSignedUrl(filePath, uploadToken, item.file, { contentType: 'video/x-ms-wmv' })
        if (storageErr) throw new Error(storageErr.message)

        // Step 3: register in DB
        const regRes = await fetch('/api/lpga/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignedName, filePath, originalFilename: item.file.name, sequenceType, width, height, sizeBytes: item.file.size })
        })
        const regJson = await regRes.json()
        if (!regRes.ok) throw new Error(regJson.error)

        setVideoItems(prev => prev.map((it, i) => i === idx ? { ...it, status: 'done', assignedName: regJson.ad.assigned_name } : it))
      } catch (err) {
        setVideoItems(prev => prev.map((it, i) => i === idx ? { ...it, status: 'error', message: err.message } : it))
      }
    }

    setVideoUploading(false)
    await loadAds()
    setTimeout(() => setVideoItems(prev => prev.filter(it => it.status === 'error')), 4000)
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

  async function downloadAd(ad) {
    try {
      const res = await fetch(ad.file_url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const ext = (ad.original_filename || ad.assigned_name).split('.').pop()
      triggerDownload(URL.createObjectURL(blob), `${ad.assigned_name}.${ext}`)
    } catch (err) {
      alert(`Download failed: ${err.message}`)
    }
  }

  async function removeAll() {
    if (!confirm(
      `⚠ Remove all ${ads.length} LPGA ad${ads.length !== 1 ? 's' : ''}?\n\nThis permanently deletes every LPGA ad file and cannot be undone. They will no longer appear in any tournament export.`
    )) return
    const res = await fetch('/api/lpga/delete-all', { method: 'DELETE' })
    if (res.ok) {
      setAds([])
    } else {
      const json = await res.json().catch(() => ({}))
      alert(`Failed to remove ads: ${json.error || 'Unknown error'}`)
    }
  }

  async function downloadAll() {
    if (!ads.length) return
    setDownloading(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const folder = zip.folder('LPGA-Ads')
      const results = await Promise.allSettled(
        ads.map(async ad => {
          const res = await fetch(ad.file_url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          const ext = (ad.original_filename || '').split('.').pop() || 'jpg'
          folder.file(`${ad.assigned_name}.${ext}`, blob)
        })
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed === ads.length) throw new Error('All file fetches failed — check Supabase bucket CORS settings.')
      const content = await zip.generateAsync({ type: 'blob' })
      triggerDownload(URL.createObjectURL(content), 'LPGA-Ads.zip')
    } catch (err) {
      alert(`Download failed: ${err.message}`)
    } finally {
      setDownloading(false)
    }
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
              accept=".jpg,.jpeg"
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
                <div className={styles.dzLabel}><strong>Drop LPGA image ads here</strong><br />or click to browse</div>
                <div className={styles.dzSub}>JPG · JPEG</div>
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

          <div className={styles.videoSection}>
            <div className={styles.videoSectionTitle}>Video Ads (.wmv)</div>
            <input
              ref={videoFileRef}
              type="file"
              accept=".wmv"
              multiple
              style={{ display: 'none' }}
              onChange={e => addVideoFiles(e.target.files)}
            />
            <button
              className={styles.videoChooseBtn}
              onClick={() => videoFileRef.current?.click()}
              disabled={videoUploading}
            >
              + Choose .wmv files…
            </button>

            {videoItems.length > 0 && (
              <div className={styles.videoItemList}>
                {videoItems.map((item, i) => (
                  <div key={i} className={styles.videoItem}>
                    <span className={styles.videoItemName}>{item.file.name}</span>
                    {item.status === 'pending' && (
                      <>
                        <input
                          type="number"
                          className={styles.videoDurInput}
                          placeholder="Seconds"
                          min="1"
                          max="999"
                          value={item.duration}
                          onChange={e => updateVideoDuration(i, e.target.value)}
                        />
                        <button className={styles.videoRemoveBtn} onClick={() => removeVideoItem(i)}>✕</button>
                      </>
                    )}
                    {item.status === 'uploading' && <span className={styles.videoItemStatus}>⏫ Uploading…</span>}
                    {item.status === 'done' && <span className={styles.videoItemDone}>✓ {item.assignedName}</span>}
                    {item.status === 'error' && <span className={styles.videoItemErr}>✗ {item.message}</span>}
                  </div>
                ))}
              </div>
            )}

            {videoItems.some(it => it.status === 'pending') && (() => {
              const pending = videoItems.filter(it => it.status === 'pending')
              const allSet  = pending.every(it => parseInt(it.duration) >= 1)
              return (
                <button
                  className={styles.videoUploadBtn}
                  onClick={handleVideoUpload}
                  disabled={!allSet || videoUploading}
                >
                  {videoUploading
                    ? 'Uploading…'
                    : `Upload ${pending.length} Video${pending.length !== 1 ? 's' : ''}`}
                </button>
              )
            })()}
          </div>
        </div>

        {/* Stats row */}
        {!loading && ads.length > 0 && (
          <div className={styles.statsRow}>
            <div className={styles.statPill}><strong>{ads.length}</strong> total ads</div>
            <div className={styles.statPill}><strong>{activeCount}</strong> active</div>
            <div className={styles.statPill}><strong>{ads.length - activeCount}</strong> inactive</div>
            <button className={styles.downloadAllBtn} onClick={downloadAll} disabled={downloading}>
              {downloading ? '⏳ Zipping…' : `⬇ Download All (${ads.length})`}
            </button>
            <button className={styles.removeAllBtn} onClick={removeAll}>
              Remove All
            </button>
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
                        <button className={styles.downloadBtn} onClick={() => downloadAd(ad)} title="Download">⬇</button>
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
