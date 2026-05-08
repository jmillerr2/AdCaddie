import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import styles from './upload.module.css'

const SLOT_DEFS = [
  { type: 'MainContent', label: 'Main Content',  size: '960 × 540',  color: 'var(--accent)',  accepts: 'Images & Videos', icon: '🖥' },
  { type: 'RightRail',  label: 'Right Rail',    size: '320 × 540',  color: 'var(--rr)',      accepts: 'Images & Videos', icon: '📐' },
  { type: 'Header',     label: 'Header',         size: '1280 × 120', color: 'var(--ticker)',  accepts: 'Images only',     icon: '📏' },
  { type: 'Ticker',     label: 'Ticker',         size: '1280 × 60',  color: 'var(--header)',  accepts: 'Images only',     icon: '📺' },
]

const EXPECTED_DIMS = [
  { label: 'Main Content',  dims: '960 × 540' },
  { label: 'Right Rail',    dims: '320 × 540' },
  { label: 'Header',        dims: '1280 × 120' },
  { label: 'Ticker',        dims: '1280 × 60' },
]

function parseDimError(message) {
  // Extract actual dimensions from: "Invalid image dimensions: 800x600. Expected ..."
  const match = message && message.match(/Invalid image dimensions[:\s]+(\d+)[x×](\d+)/i)
  if (match) return { width: match[1], height: match[2] }
  return null
}

export default function UploadPortal() {
  const router = useRouter()
  const { token } = router.query

  const [tournament, setTournament] = useState(null)
  const [uploads, setUploads]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [dragging, setDragging]     = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [uploadProgress, setUploadProgress] = useState([])
  const [isComplete, setIsComplete] = useState(false)
  const [completingLoading, setCompletingLoading] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    if (token) loadTournament()
  }, [token])

  async function loadTournament() {
    setLoading(true)
    const { data: t, error } = await supabase
      .from('tournaments')
      .select('id, name, notes, deadline, created_at, is_complete')
      .eq('upload_token', token)
      .single()

    if (error || !t) { setNotFound(true); setLoading(false); return }
    setTournament(t)
    setIsComplete(!!t.is_complete)

    const { data: ups } = await supabase
      .from('uploads')
      .select('*')
      .eq('tournament_id', t.id)
      .order('created_at', { ascending: true })

    setUploads(ups || [])
    setLoading(false)
  }

  async function handleFiles(files) {
    if (!files || !files.length) return
    setUploading(true)

    const fileArr = Array.from(files)
    const progress = fileArr.map(f => ({ name: f.name, status: 'pending' }))
    setUploadProgress(progress)

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      const updProg = [...progress]
      updProg[i] = { ...updProg[i], status: 'uploading' }
      setUploadProgress([...updProg])

      try {
        const ext = file.name.split('.').pop().toLowerCase()
        const isVid = ext === 'wmv'

        // Read dimensions (and duration for videos) client-side
        let width = 0, height = 0, duration = null
        if (isVid) {
          const dims = await getVideoDimensions(file).catch(() => null)
          if (dims) { width = dims.width; height = dims.height; duration = dims.duration }
          // WMV files can't be decoded by the browser — fall back to parsing from filename e.g. "ad(30).wmv"
          if (!duration || isNaN(duration)) duration = parseDurationFromFilename(file.name)
        } else {
          const dims = await getImageDimensions(file).catch(() => null)
          if (dims) { width = dims.width; height = dims.height }
        }

        // Step 1: validate + get signed upload URL from server
        const durParam = duration != null ? `&duration=${duration}` : ''
        const signRes = await fetch(
          `/api/upload/${token}?filename=${encodeURIComponent(file.name)}&width=${width}&height=${height}&size=${file.size}${durParam}`
        )
        let signJson = {}
        try { signJson = await signRes.json() } catch {
          signJson = { error: `Server error (${signRes.status})` }
        }
        if (!signRes.ok) {
          updProg[i] = { ...updProg[i], status: 'error', message: signJson.error }
          setUploadProgress([...updProg])
          continue
        }

        const { assignedName, filePath, sequenceType, uploadToken, isLate, tournamentId } = signJson

        // Step 2: upload directly to Supabase Storage (bypasses Vercel size limit)
        const { error: storageErr } = await supabase.storage
          .from('ads')
          .uploadToSignedUrl(filePath, uploadToken, file, {
            contentType: file.type || 'application/octet-stream'
          })
        if (storageErr) {
          updProg[i] = { ...updProg[i], status: 'error', message: storageErr.message }
          setUploadProgress([...updProg])
          continue
        }

        // Step 3: register upload record in DB
        const regRes = await fetch(`/api/upload/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignedName, filePath, sequenceType,
            originalFilename: file.name,
            width, height,
            isVideo: isVid,
            sizeBytes: file.size,
            isLate,
            tournamentId,
          })
        })
        let regJson = {}
        try { regJson = await regRes.json() } catch {
          regJson = { error: `Server error (${regRes.status})` }
        }
        if (!regRes.ok) {
          updProg[i] = { ...updProg[i], status: 'error', message: regJson.error }
        } else {
          updProg[i] = { ...updProg[i], status: 'done', upload: regJson.upload }
        }
        setUploadProgress([...updProg])
      } catch (err) {
        updProg[i] = { ...updProg[i], status: 'error', message: err.message }
        setUploadProgress([...updProg])
      }
    }

    setUploading(false)
    await loadTournament()
    setTimeout(() => setUploadProgress([]), 6000)
  }

  function parseDurationFromFilename(filename) {
    const m = filename.match(/\((\d+)(?:seconds?|secs?|s)?\)/i)
    return m ? parseInt(m[1]) : null
  }

  function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
      img.onerror = reject
      img.src = url
    })
  }

  function getVideoDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
        URL.revokeObjectURL(url)
      }
      video.onerror = reject
      video.src = url
    })
  }

  async function deleteUpload(id, filename) {
    if (!confirm(`Remove "${filename}" from your uploads?\n\nThis cannot be undone.`)) return
    const res = await fetch(`/api/delete/${id}`, { method: 'DELETE' })
    if (res.ok) setUploads(prev => prev.filter(u => u.id !== id))
  }

  async function toggleComplete() {
    const next = !isComplete
    if (next && !confirm('Mark your ad uploads as complete?\n\nThe tournament team will be notified. You can still unmark this later if needed.')) return
    setCompletingLoading(true)
    const res = await fetch(`/api/tournament/complete/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_complete: next }),
    })
    if (res.ok) setIsComplete(next)
    setCompletingLoading(false)
  }

  function onDragOver(e) { e.preventDefault(); setDragging(true) }
  function onDragLeave()  { setDragging(false) }
  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const uploadsFor = type => uploads.filter(u => u.sequence_type === type)

  const isPastDeadline = tournament?.deadline && new Date() > new Date(tournament.deadline)

  // ── STATES ──
  if (loading) return (
    <div className={styles.centerWrap}>
      <div className={styles.spinner} />
      <div className={styles.loadingText}>Loading…</div>
    </div>
  )

  if (notFound) return (
    <div className={styles.centerWrap}>
      <div className={styles.notFoundIcon}>⛳</div>
      <div className={styles.notFoundTitle}>Link not found</div>
      <div className={styles.notFoundSub}>This upload link is invalid or has expired. Contact your tournament representative.</div>
    </div>
  )

  return (
    <div className={styles.wrap}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>⛳</span>
            <span className={styles.logoText}>AdCaddie</span>
          </div>
          <div className={styles.tournInfo}>
            <div className={styles.tournName}>{tournament.name}</div>
            <div className={styles.tournSub}>Ad Upload Portal</div>
          </div>
          <div className={styles.headerRight}>
            {isComplete ? (
              <div className={styles.headerCompleteWrap}>
                <span className={styles.headerCompleteBadge}>✓ Uploads complete</span>
                <button className={styles.headerUnmarkBtn} onClick={toggleComplete} disabled={completingLoading}>
                  {completingLoading ? '…' : 'Unmark'}
                </button>
              </div>
            ) : (
              <button
                className={styles.headerCompleteBtn}
                onClick={toggleComplete}
                disabled={completingLoading || uploads.length === 0}
                title={uploads.length === 0 ? 'Upload at least one file first' : 'Mark uploads as complete'}
              >
                {completingLoading ? 'Saving…' : '✓ Mark complete'}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className={styles.container}>

        {/* Deadline banners */}
        {isPastDeadline && (
          <div className={styles.deadlineBanner}>
            <div className={styles.deadlineBannerIcon}>⚠️</div>
            <div className={styles.deadlineBannerText}>
              <div className={styles.deadlineBannerTitle}>Upload deadline has passed</div>
              <div className={styles.deadlineBannerSub}>
                The deadline was {new Date(tournament.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.
                You can still upload files, but they will be marked as late.
              </div>
            </div>
          </div>
        )}

        {!isPastDeadline && tournament?.deadline && (
          <div className={styles.deadlineInfoBanner}>
            ⏰ <strong>Deadline:</strong>&nbsp;
            {new Date(tournament.deadline).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}

        {/* Complete banner */}
        {isComplete && (
          <div className={styles.completeBanner}>
            <div className={styles.completeBannerIcon}>✓</div>
            <div className={styles.completeBannerText}>
              <div className={styles.completeBannerTitle}>Uploads marked as complete</div>
              <div className={styles.completeBannerSub}>The tournament team has been notified. You can still add or remove files below.</div>
            </div>
            <button className={styles.unmarkBtn} onClick={toggleComplete} disabled={completingLoading}>
              {completingLoading ? '…' : 'Unmark'}
            </button>
          </div>
        )}

        {/* Instructions */}
        <div className={styles.instructCard}>
          <div className={styles.instructTitle}>How to upload your ads</div>
          <div className={styles.instructGrid}>
            {SLOT_DEFS.map(s => (
              <div key={s.type} className={styles.instructSlot} style={{ borderColor: s.color + '55' }}>
                <div className={styles.instructIcon}>{s.icon}</div>
                <div className={styles.instructLabel} style={{ color: s.color }}>{s.label}</div>
                <div className={styles.instructSize}>{s.size}</div>
                <div className={styles.instructAccepts}>{s.accepts}</div>
              </div>
            ))}
          </div>
          <div className={styles.instructNote}>
            Files are automatically detected and named based on their dimensions. You don&apos;t need to rename anything.
          </div>
        </div>

        {/* Drop zone */}
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
            accept=".jpg,.jpeg,.wmv"
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          {uploading ? (
            <div className={styles.dzUploading}>
              <div className={styles.spinner} />
              <div className={styles.dzLabel}>Uploading files…</div>
            </div>
          ) : (
            <>
              <div className={styles.dzIcon}>📁</div>
              <div className={styles.dzLabel}><strong>Drop your ad files here</strong><br />or click to browse</div>
              <div className={styles.dzSub}>JPG · JPEG · WMV</div>
            </>
          )}
        </div>

        {/* Upload progress */}
        {uploadProgress.length > 0 && (
          <div className={styles.progressList}>
            {uploadProgress.map((p, i) => {
              const dimError = p.status === 'error' ? parseDimError(p.message) : null
              return (
                <div key={i} className={`${styles.progressItem} ${styles[p.status]}`}>
                  <span className={styles.progressIcon}>
                    {p.status === 'pending'   ? '⏳' :
                     p.status === 'uploading' ? '⏫' :
                     p.status === 'done'      ? '✓'  : '✗'}
                  </span>
                  <span className={styles.progressName}>{p.name}</span>
                  {p.status === 'done' && p.upload &&
                    <span className={styles.progressAssigned}>→ {p.upload.assigned_name} ({p.upload.sequence_type})</span>
                  }
                  {p.status === 'error' && (
                    dimError ? (
                      <div className={styles.dimErrorWrap}>
                        <div className={styles.dimErrorMain}>
                          Dimensions detected: <strong>{dimError.width} × {dimError.height}</strong> — no matching slot
                        </div>
                        <div className={styles.dimErrorHelp}>
                          Please resize your file to one of the accepted sizes:
                          {EXPECTED_DIMS.map(d => (
                            <div key={d.label}> · <strong>{d.dims}</strong> — {d.label}</div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className={styles.progressError}>{p.message}</span>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Uploaded files by slot */}
        {SLOT_DEFS.map(slot => {
          const slotUploads = uploadsFor(slot.type)
          if (slotUploads.length === 0) return null
          return (
            <div key={slot.type} className={styles.slotSection}>
              <div className={styles.slotHeader} style={{ color: slot.color }}>
                <span>{slot.icon} {slot.label}</span>
                <span className={styles.slotCount}>{slotUploads.length} file{slotUploads.length !== 1 ? 's' : ''}</span>
              </div>
              <div className={styles.fileGrid}>
                {slotUploads.map(u => (
                  <div key={u.id} className={styles.fileCard} style={{ borderColor: slot.color + '44' }}>
                    <div className={styles.fileThumb}>
                      {u.is_video ? (
                        <div className={styles.videoThumb}>🎬</div>
                      ) : (
                        <img src={u.file_url} alt={u.assigned_name} className={styles.thumbImg} />
                      )}
                    </div>
                    <div className={styles.fileInfo}>
                      <div className={styles.fileName} style={{ color: slot.color }}>
                        {u.assigned_name}
                        {u.is_late && <span className={styles.lateBadgeCard}>Late</span>}
                      </div>
                      <div className={styles.fileOrig}>{u.original_filename}</div>
                      <div className={styles.fileMeta}>{u.width}×{u.height} · {u.is_video ? 'Video' : 'Image'} · {Math.round(u.size_bytes / 1024)} KB</div>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => deleteUpload(u.id, u.original_filename)}
                      title="Delete this file"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {uploads.length === 0 && uploadProgress.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📂</div>
            <div className={styles.emptyText}>No files uploaded yet</div>
            <div className={styles.emptySub}>Drop your ad files above to get started</div>
          </div>
        )}

        <div className={styles.footer}>
          Powered by <strong>AdCaddie</strong> · Files are automatically organized for the video board
        </div>
      </div>
    </div>
  )
}
