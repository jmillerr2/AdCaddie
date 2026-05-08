// Generates elements.json and sequences.json for a tournament
// matching the exact format used by the video board app

const SYSTEM_ELEMENTS = [
  {
    type: 'PlayerScoring_Scorecards',
    category: 'Graphics',
    name: '_SC',
    settings: [{ name: 'PageIntervalInSeconds', value: '8' }]
  },
  {
    type: 'ProjectedCut',
    category: 'Graphics',
    name: '_ProjCut',
    settings: [
      { name: 'BkgdColor', value: '' },
      { name: 'Title', value: '' },
      { name: 'FeedType', value: '' }
    ]
  },
  {
    type: 'Leaderboard',
    category: 'Graphics',
    name: '_LB',
    settings: [
      { name: 'FeedType', value: '' },
      { name: 'NumberOfPagesToCycle', value: '3' },
      { name: 'PageIntervalInSeconds', value: '10' },
      { name: 'Title', value: '' },
      { name: 'BkgdColor', value: '' },
      { name: 'Loop', value: 'False' }
    ]
  },
  {
    type: 'Locator_NextOn',
    category: 'Graphics',
    name: '_NOG',
    settings: [
      { name: 'Location', value: '' },
      { name: 'HoleNumber', value: '' }
    ]
  }
]

const SYS_A = [
  { name: '_SC', duration: 24 },
  { name: '_LB', duration: 30 },
  { name: '_ProjCut', duration: 10 }
]
const SYS_B = [
  { name: '_SC', duration: 24 },
  { name: '_LB', duration: 30 },
  { name: '_NOG', duration: 10 }
]

const BASE_PATH = 'C:\\LPGA_LEDHD\\Images\\Ads\\'
const LPGA_PATH = 'C:\\LPGA_LEDHD\\Images\\Ads\\LPGA\\'

export function generateElementsJSON(uploads, lpgaAds = []) {
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

  // Always append system elements
  SYSTEM_ELEMENTS.forEach(el => entries.push(el))

  return entries
}

export function generateSequencesJSON(uploads, lpgaAds = []) {
  const sequences = []

  // ── MAIN CONTENT ──────────────────────────────
  const mcUploads = uploads
    .filter(u => u.sequence_type === 'MainContent')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  const activeLpga = lpgaAds
    .filter(a => a.is_active !== false)
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  if (mcUploads.length > 0) {
    const steps = []
    let idx = 1

    // Number of cycles = enough to exhaust whichever list is longer
    // Each cycle: 2 tournament ads → 1 LPGA ad (if any) → system set
    const tournPairs = Math.ceil(mcUploads.length / 2)
    const cycles = activeLpga.length > 0
      ? Math.max(tournPairs, activeLpga.length)
      : tournPairs

    for (let cy = 0; cy < cycles; cy++) {
      const t1  = mcUploads[(cy * 2) % mcUploads.length]
      // Only add t2 if there's more than one tournament ad (avoid repeating the same ad)
      const t2  = mcUploads.length > 1 ? mcUploads[(cy * 2 + 1) % mcUploads.length] : null
      const sys = cy % 2 === 0 ? SYS_A : SYS_B

      steps.push({ sortIndex: idx++, duration: t1.is_video ? (parseDuration(t1.assigned_name) ?? 15) : 8, elementName: t1.assigned_name, isActive: true })
      if (t2) steps.push({ sortIndex: idx++, duration: t2.is_video ? (parseDuration(t2.assigned_name) ?? 15) : 8, elementName: t2.assigned_name, isActive: true })

      if (activeLpga.length > 0) {
        const lpga = activeLpga[cy % activeLpga.length]
        steps.push({ sortIndex: idx++, duration: lpga.is_video ? (parseDuration(lpga.assigned_name) ?? 15) : 8, elementName: lpga.assigned_name, isActive: true })
      }

      for (const s of sys) steps.push({ sortIndex: idx++, duration: s.duration, elementName: s.name, isActive: true })
    }
    sequences.push({ name: 'MainContent', steps })
  }

  // ── RIGHT RAIL ────────────────────────────────
  const rrUploads = uploads
    .filter(u => u.sequence_type === 'RightRail')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  if (rrUploads.length > 0) {
    const steps = rrUploads.map((u, i) => ({
      sortIndex: i + 1,
      duration: u.is_video ? (parseDuration(u.assigned_name) ?? 30) : 300,
      elementName: u.assigned_name,
      isActive: true
    }))
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

export function assignName(sequenceType, existingCount, durationSeconds) {
  const n      = String(existingCount + 1).padStart(2, '0')
  const dur    = durationSeconds ? `(${Math.round(durationSeconds)}s)` : ''
  switch (sequenceType) {
    case 'MainContent': return `${n}${dur}`
    case 'RightRail':   return `R-${n}${dur}`
    case 'Header':      return `H-${n}${dur}`
    case 'Ticker':      return `T-${n}${dur}`
    default:            return `${n}${dur}`
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
