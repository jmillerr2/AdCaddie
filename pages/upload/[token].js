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
  const fileRef = useRef()

  useEffect(() => {
    if (token) loadTournament()
  }, [token])

  async function loadTournament() {
    setLoading(true)
    const { data: t, error } = await supabase
      .from('tournaments')
      .select('id, name, notes, deadline, created_at')
      .eq('upload_token', token)
      .single()

    if (error || !t) { setNotFound(true); setLoading(false); return }
    setTournament(t)

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
        const formData = new FormData()
        formData.append('file', file)

        let extraQuery = ''
        const isVid = /\.(wmv|mp4|mov|avi|mpg|mpeg)$/i.test(file.name)
        if (isVid) {
          const dims = await getVideoDimensions(file).catch(() => null)
          if (dims) extraQuery = `&width=${dims.width}&height=${dims.height}`
        }

        const res = await fetch(`/api/upload/${token}${extraQuery ? '?' + extraQuery.slice(1) : ''}`, {
          method: 'POST',
          body: formData
        })

        const json = await res.json()
        if (!res.ok) {
          updProg[i] = { ...updProg[i], status: 'error', message: json.error }
        } else {
          updProg[i] = { ...updProg[i], status: 'done', upload: json.upload }
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

  function getVideoDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth, height: video.videoHeight })
        URL.revokeObjectURL(url)
      }
      video.onerror = reject
      video.src = url
    })
  }

  async function deleteUpload(id) {
    const res = await fetch(`/api/delete/${id}`, { method: 'DELETE' })
    if (res.ok) setUploads(prev => prev.filter(u => u.id !== id))
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
              <div className={styles.dzSub}>JPG · PNG · WebP · MP4 · WMV · MOV</div>
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
                      onClick={() => deleteUpload(u.id)}
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
