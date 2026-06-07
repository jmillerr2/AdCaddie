// Generates elements.json and sequences.json for a tournament
// matching the exact format used by the video board app

export const SYSTEM_ELEMENT_DEFS = {
  _SC: {
    type: 'PlayerScoring_Scorecards',
    category: 'Graphics',
    name: '_SC',
    label: 'Scorecards',
    defaultDuration: 24,
    settings: [{ name: 'PageIntervalInSeconds', value: '8' }]
  },
  _LB: {
    type: 'Leaderboard',
    category: 'Graphics',
    name: '_LB',
    label: 'Leaderboard',
    defaultDuration: 30,
    settings: [
      { name: 'FeedType', value: '' },
      { name: 'NumberOfPagesToCycle', value: '3' },
      { name: 'PageIntervalInSeconds', value: '10' },
      { name: 'Title', value: '' },
      { name: 'BkgdColor', value: '' },
      { name: 'Loop', value: 'False' }
    ]
  },
  _ProjCut: {
    type: 'ProjectedCut',
    category: 'Graphics',
    name: '_ProjCut',
    label: 'Projected Cut',
    defaultDuration: 10,
    settings: [
      { name: 'BkgdColor', value: '' },
      { name: 'Title', value: '' },
      { name: 'FeedType', value: '' }
    ]
  },
  _NOG: {
    type: 'Locator_NextOn',
    category: 'Graphics',
    name: '_NOG',
    label: 'Next On Green',
    defaultDuration: 10,
    settings: [
      { name: 'Location', value: '' },
      { name: 'HoleNumber', value: '' }
    ]
  }
}

// Fixed display order for system elements
const SYS_ORDER = ['_SC', '_LB', '_ProjCut', '_NOG']

const BASE_PATH = 'C:\\LPGA_LEDHD\\Images\\Ads\\'
const LPGA_PATH = 'C:\\LPGA_LEDHD\\Images\\Ads\\LPGA\\'

// Build active system element list from settings (null = all enabled with defaults)
function getActiveSysElements(settings) {
  return SYS_ORDER
    .filter(key => !settings || settings[key]?.enabled !== false)
    .map(key => {
      const def = SYSTEM_ELEMENT_DEFS[key]
      const duration = (settings?.[key]?.duration != null)
        ? Number(settings[key].duration)
        : def.defaultDuration
      return { name: key, duration }
    })
}

export function generateElementsJSON(uploads, lpgaAds = [], settings = null) {
  const entries = []

  uploads.forEach(u => {
    const type = u.is_video ? 'Video_File' : 'Graphic'
    const fkey = u.is_video ? 'VideoFile' : 'ImageFile'
    const ext  = u.original_filename.split('.').pop()
    entries.push({
      type,
      category: 'Graphics',
      name: u.assigned_name,
      settings: [{ name: fkey, value: BASE_PATH + u.assigned_name + '.' + ext }]
    })
  })

  lpgaAds.forEach(ad => {
    const type = ad.is_video ? 'Video_File' : 'Graphic'
    const fkey = ad.is_video ? 'VideoFile' : 'ImageFile'
    const ext  = (ad.original_filename || '').split('.').pop()
    entries.push({
      type,
      category: 'Graphics',
      name: ad.assigned_name,
      settings: [{ name: fkey, value: LPGA_PATH + ad.assigned_name + '.' + ext }]
    })
  })

  // Only include enabled system elements
  const activeKeys = SYS_ORDER.filter(key => !settings || settings[key]?.enabled !== false)
  activeKeys.forEach(key => {
    const def = SYSTEM_ELEMENT_DEFS[key]
    entries.push({
      type:     def.type,
      category: def.category,
      name:     def.name,
      settings: def.settings,
    })
  })

  return entries
}

export function generateSequencesJSON(uploads, lpgaAds = [], settings = null) {
  const sequences = []
  const sysElements = getActiveSysElements(settings)

  // ── MAIN CONTENT ──────────────────────────────
  // Pattern per cycle: 2 tournament ads → 1 LPGA ad → system block
  const mcUploads = uploads
    .filter(u => u.sequence_type === 'MainContent')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  const activeLpgaMC = lpgaAds
    .filter(a => a.is_active !== false && a.sequence_type === 'MainContent')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  if (mcUploads.length > 0 || activeLpgaMC.length > 0) {
    const steps = []
    let idx = 1

    const tournPairs = Math.ceil(mcUploads.length / 2)
    const cycles = activeLpgaMC.length > 0
      ? Math.max(tournPairs, activeLpgaMC.length)
      : tournPairs

    for (let cy = 0; cy < cycles; cy++) {
      // 2 tournament MC ads (8s each, or video duration)
      if (mcUploads.length > 0) {
        const t1 = mcUploads[(cy * 2) % mcUploads.length]
        steps.push({ sortIndex: idx++, duration: t1.is_video ? (parseDuration(t1.assigned_name) ?? 15) : 8, elementName: t1.assigned_name, isActive: true })
        if (mcUploads.length > 1) {
          const t2 = mcUploads[(cy * 2 + 1) % mcUploads.length]
          steps.push({ sortIndex: idx++, duration: t2.is_video ? (parseDuration(t2.assigned_name) ?? 15) : 8, elementName: t2.assigned_name, isActive: true })
        }
      }

      // 1 LPGA MC ad (8s each, or video duration)
      if (activeLpgaMC.length > 0) {
        const lpga = activeLpgaMC[cy % activeLpgaMC.length]
        steps.push({ sortIndex: idx++, duration: lpga.is_video ? (parseDuration(lpga.assigned_name) ?? 15) : 8, elementName: lpga.assigned_name, isActive: true })
      }

      // System elements block (only enabled elements, configurable durations)
      for (const s of sysElements) {
        steps.push({ sortIndex: idx++, duration: s.duration, elementName: s.name, isActive: true })
      }
    }
    sequences.push({ name: 'MainContent', steps })
  }

  // ── RIGHT RAIL ────────────────────────────────
  // Pattern: tournament ad, LPGA ad, tournament ad, LPGA ad... — 300s each (or video duration)
  const rrTournament = uploads
    .filter(u => u.sequence_type === 'RightRail')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  const rrLpga = lpgaAds
    .filter(a => a.is_active !== false && a.sequence_type === 'RightRail')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  if (rrTournament.length > 0 || rrLpga.length > 0) {
    const steps = []
    const cycles = Math.max(rrTournament.length, rrLpga.length)
    let idx = 1
    for (let i = 0; i < cycles; i++) {
      if (rrTournament.length > 0) {
        const t = rrTournament[i % rrTournament.length]
        steps.push({ sortIndex: idx++, duration: t.is_video ? (parseDuration(t.assigned_name) ?? 300) : 300, elementName: t.assigned_name, isActive: true })
      }
      if (rrLpga.length > 0) {
        const l = rrLpga[i % rrLpga.length]
        steps.push({ sortIndex: idx++, duration: l.is_video ? (parseDuration(l.assigned_name) ?? 300) : 300, elementName: l.assigned_name, isActive: true })
      }
    }
    sequences.push({ name: 'RightRail', steps })
  }

  // ── TICKER ────────────────────────────────────
  const tickerUploads = uploads.filter(u => u.sequence_type === 'Ticker')
  if (tickerUploads.length > 0) {
    sequences.push({
      name: 'Ticker',
      steps: tickerUploads.map((u, i) => ({
        sortIndex: i + 1,
        duration: -1,
        elementName: u.assigned_name,
        isActive: true
      }))
    })
  }

  // ── HEADER ────────────────────────────────────
  const headerUploads = uploads.filter(u => u.sequence_type === 'Header')
  if (headerUploads.length > 0) {
    sequences.push({
      name: 'Header',
      steps: headerUploads.map((u, i) => ({
        sortIndex: i + 1,
        duration: -1,
        elementName: u.assigned_name,
        isActive: true
      }))
    })
  }

  return sequences
}

// Sanitize original filename to a safe suffix: strip extension, remove unsafe chars
function safeBaseName(originalFilename) {
  if (!originalFilename) return ''
  return originalFilename
    .replace(/\.[^.]+$/, '')                  // strip extension
    .replace(/[^a-zA-Z0-9 _\-]/g, '')        // keep alphanumeric, space, underscore, hyphen
    .trim()
}

export function assignName(sequenceType, existingCount, durationSeconds, originalFilename) {
  const n    = String(existingCount + 1).padStart(2, '0')
  const dur  = durationSeconds ? `(${Math.round(durationSeconds)}s)` : ''
  const base = originalFilename ? ` - ${safeBaseName(originalFilename)}` : ''

  switch (sequenceType) {
    case 'MainContent': return `${n}${dur}${base}`
    case 'RightRail':   return `R-${n}${dur}${base}`
    case 'Header':      return '_Header'
    case 'Ticker':      return '_Ticker'
    default:            return `${n}${dur}${base}`
  }
}

function parseDuration(assignedName) {
  const m = (assignedName || '').match(/\((\d+)s\)/)
  return m ? parseInt(m[1]) : null
}

export function detectSequenceType(width, height) {
  if (width === 960  && height === 540) return 'MainContent'
  if (width === 320  && height === 540) return 'RightRail'
  if (width === 1280 && height === 120) return 'Header'
  if (width === 1280 && height === 60)  return 'Ticker'
  return null
}
