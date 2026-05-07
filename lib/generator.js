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

export function generateElementsJSON(uploads) {
  const entries = []

  // Tournament ads (MainContent + RightRail + Header + Ticker)
  const tournamentUploads = uploads.filter(u =>
    !u.assigned_name.startsWith('C') // not LPGA ads
  )

  tournamentUploads.forEach(u => {
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

  // Always append system elements
  SYSTEM_ELEMENTS.forEach(el => entries.push(el))

  return entries
}

export function generateSequencesJSON(uploads) {
  const sequences = []

  // ── MAIN CONTENT ──────────────────────────────
  const mcUploads = uploads
    .filter(u => u.sequence_type === 'MainContent')
    .sort((a, b) => a.assigned_name.localeCompare(b.assigned_name))

  if (mcUploads.length > 0) {
    const steps = []
    let idx = 1
    // For now: simple sequence, each item 8s (videos use duration from name)
    // Pattern mirrors the HTML tool: pairs of tournament ads + system sets
    const half = Math.ceil(mcUploads.length / 2)
    for (let cy = 0; cy < half; cy++) {
      const t1  = mcUploads[(cy * 2) % mcUploads.length]
      const t2  = mcUploads[(cy * 2 + 1) % mcUploads.length]
      const sys = cy % 2 === 0 ? SYS_A : SYS_B
      steps.push({ sortIndex: idx++, duration: t1.is_video ? 15 : 8, elementName: t1.assigned_name, isActive: true })
      if (t2) steps.push({ sortIndex: idx++, duration: t2.is_video ? 15 : 8, elementName: t2.assigned_name, isActive: true })
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
      duration: u.is_video ? 30 : 300,
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

export function assignName(sequenceType, existingCount) {
  const n = String(existingCount + 1).padStart(2, '0')
  switch (sequenceType) {
    case 'MainContent': return n              // 01, 02, 03
    case 'RightRail':   return `R-${n}`       // R-01, R-02
    case 'Header':      return `H-${n}`       // H-01, H-02
    case 'Ticker':      return `T-${n}`       // T-01, T-02
    default:            return n
  }
}

export function detectSequenceType(width, height) {
  if (width === 960  && height === 540) return 'MainContent'
  if (width === 320  && height === 540) return 'RightRail'
  if (width === 1280 && height === 120) return 'Header'
  if (width === 1280 && height === 60)  return 'Ticker'
  return null
}
