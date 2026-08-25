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

// Sort by the admin's manually-set drag order (sort_order), falling back to
// assigned_name for anything not yet manually ordered — never renames anything,
// just decides playback order.
function bySortOrder(a, b) {
  const ao = a.sort_order ?? Infinity
  const bo = b.sort_order ?? Infinity
  if (ao !== bo) return ao - bo
  return a.assigned_name.localeCompare(b.assigned_name)
}

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

// Build one sequence's steps from a list of tournament ads, LPGA ads, and system elements
function buildMCSteps(tournAds, lpgaAds, sysElements) {
  const steps = []
  let idx = 1
  const tournPairs = Math.ceil(tournAds.length / 2)
  const cycles = lpgaAds.length > 0
    ? Math.max(tournPairs, lpgaAds.length)
    : Math.max(tournPairs, 1)

  for (let cy = 0; cy < cycles; cy++) {
    if (tournAds.length > 0) {
      const t1 = tournAds[(cy * 2) % tournAds.length]
      steps.push({ sortIndex: idx++, duration: t1.is_video ? (parseDuration(t1.assigned_name) ?? 15) : 8, elementName: t1.assigned_name, isActive: true })
      if (tournAds.length > 1) {
        const t2 = tournAds[(cy * 2 + 1) % tournAds.length]
        steps.push({ sortIndex: idx++, duration: t2.is_video ? (parseDuration(t2.assigned_name) ?? 15) : 8, elementName: t2.assigned_name, isActive: true })
      }
    }
    if (lpgaAds.length > 0) {
      const lpga = lpgaAds[cy % lpgaAds.length]
      steps.push({ sortIndex: idx++, duration: lpga.is_video ? (parseDuration(lpga.assigned_name) ?? 15) : 8, elementName: lpga.assigned_name, isActive: true })
    }

    // Alternate Scorecards / Next On Green each cycle; Leaderboard + Projected Cut appear every cycle
    const byName = Object.fromEntries(sysElements.map(s => [s.name, s]))
    const alternator = (cy % 2 === 0) ? byName['_SC'] : byName['_NOG']
    const cycleSys = [alternator, byName['_LB'], byName['_ProjCut']].filter(Boolean)

    for (const s of cycleSys) {
      steps.push({ sortIndex: idx++, duration: s.duration, elementName: s.name, isActive: true })
    }
  }
  return steps
}

// Build one sequence's steps from a user-defined template: cycles = array of
// cycle rows, each an ordered array of blocks { type: 'tournament_ad' | 'lpga_ad' | 'system', systemKey? }.
// Cycles play in order (A, B, C…) and loop back to the start; tournament/LPGA
// ad indices keep advancing across the whole loop rather than resetting per cycle,
// so e.g. cycle A can consume ads 1-2 while cycle B consumes ads 3-4.
function buildMCStepsFromTemplate(tournAds, lpgaAds, sysElements, cycles) {
  const steps = []
  let idx = 1
  const byName = Object.fromEntries(sysElements.map(s => [s.name, s]))

  const cleanCycles = (cycles || []).filter(c => Array.isArray(c) && c.length > 0)
  if (cleanCycles.length === 0) return steps

  const tournSlotsPerPass = cleanCycles.reduce((n, c) => n + c.filter(b => b.type === 'tournament_ad').length, 0)
  const lpgaSlotsPerPass  = cleanCycles.reduce((n, c) => n + c.filter(b => b.type === 'lpga_ad').length, 0)

  const passesForTourn = (tournAds.length > 0 && tournSlotsPerPass > 0) ? Math.ceil(tournAds.length / tournSlotsPerPass) : 0
  const passesForLpga  = (lpgaAds.length > 0 && lpgaSlotsPerPass > 0) ? Math.ceil(lpgaAds.length / lpgaSlotsPerPass) : 0
  const passes = Math.max(passesForTourn, passesForLpga, 1)

  let tournIdx = 0
  let lpgaIdx = 0

  for (let p = 0; p < passes; p++) {
    for (const cycle of cleanCycles) {
      for (const block of cycle) {
        if (block.type === 'tournament_ad') {
          if (tournAds.length === 0) continue
          const t = tournAds[tournIdx % tournAds.length]
          tournIdx++
          steps.push({ sortIndex: idx++, duration: t.is_video ? (parseDuration(t.assigned_name) ?? 15) : 8, elementName: t.assigned_name, isActive: true })
        } else if (block.type === 'lpga_ad') {
          if (lpgaAds.length === 0) continue
          const l = lpgaAds[lpgaIdx % lpgaAds.length]
          lpgaIdx++
          steps.push({ sortIndex: idx++, duration: l.is_video ? (parseDuration(l.assigned_name) ?? 15) : 8, elementName: l.assigned_name, isActive: true })
        } else if (block.type === 'system') {
          const s = byName[block.systemKey]
          if (!s) continue
          const duration = block.duration != null ? Number(block.duration) : s.duration
          steps.push({ sortIndex: idx++, duration, elementName: s.name, isActive: true })
        }
      }
    }
  }

  return steps
}

// sequenceConfigs: array of { id, name, tournamentAdNames[], lpgaAdNames[], systemElements{}, templateId? }
// templatesById: { [templateId]: { cycles: [...] } } — required when any config has a templateId set.
// When sequenceConfigs is provided, generates one named sequence per config instead of the default single sequence.
export function generateSequencesJSON(uploads, lpgaAds = [], settings = null, sequenceConfigs = null, templatesById = {}) {
  const sequences = []

  // ── MAIN CONTENT ──────────────────────────────
  const allMcUploads = uploads
    .filter(u => u.sequence_type === 'MainContent')
    .sort(bySortOrder)

  const allActiveLpgaMC = lpgaAds
    .filter(a => a.is_active !== false && a.sequence_type === 'MainContent')
    .sort(bySortOrder)

  if (sequenceConfigs && sequenceConfigs.length > 0) {
    // ── CUSTOM SEQUENCES ──────────────────────────
    for (const cfg of sequenceConfigs) {
      const tournAds  = allMcUploads.filter(u => cfg.tournamentAdNames.includes(u.assigned_name))
      const cfgLpga   = allActiveLpgaMC.filter(a => cfg.lpgaAdNames.includes(a.assigned_name))
      const cfgSys    = getActiveSysElements(cfg.systemElements)
      if (tournAds.length === 0 && cfgLpga.length === 0) continue
      const template  = cfg.templateId ? templatesById[cfg.templateId] : null
      const steps      = template
        ? buildMCStepsFromTemplate(tournAds, cfgLpga, cfgSys, template.cycles)
        : buildMCSteps(tournAds, cfgLpga, cfgSys)
      if (steps.length > 0) sequences.push({ name: cfg.name, steps })
    }
  } else if (allMcUploads.length > 0 || allActiveLpgaMC.length > 0) {
    // ── DEFAULT SINGLE SEQUENCE ───────────────────
    const sysElements = getActiveSysElements(settings)
    const steps = buildMCSteps(allMcUploads, allActiveLpgaMC, sysElements)
    if (steps.length > 0) sequences.push({ name: 'MainContent', steps })
  }

  // ── RIGHT RAIL ────────────────────────────────
  // Pattern: tournament ad, LPGA ad, tournament ad, LPGA ad... — 300s each (or video duration)
  const rrTournament = uploads
    .filter(u => u.sequence_type === 'RightRail')
    .sort(bySortOrder)

  const rrLpga = lpgaAds
    .filter(a => a.is_active !== false && a.sequence_type === 'RightRail')
    .sort(bySortOrder)

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
  const tickerUploads = uploads.filter(u => u.sequence_type === 'Ticker').sort(bySortOrder)
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
  const headerUploads = uploads.filter(u => u.sequence_type === 'Header').sort(bySortOrder)
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
