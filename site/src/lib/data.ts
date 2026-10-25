/**
 * Build-time access to the pipeline data under ../data (relative to site/).
 *
 * Everything here runs inside the Astro build only: snapshots and history are
 * read from disk, validated once and cached for the whole build. The browser
 * never loads this module; pages are fully static.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface SnapshotUser {
  login: string
  name: string | null
  avatarUrl: string
  location: string | null
  company: string | null
  twitterUsername: string | null
  followers: number
  totalContributions: number
  privateContributions: number
  publicContributions: number
}

export interface Snapshot {
  country: string
  geoName: string
  cities: string[]
  collectedAt: string
  minimumFollowers: number
  users: SnapshotUser[]
}

export interface LeaderEntry {
  login: string
  value: number
}

export interface HistoryLine {
  date: string
  collectedAt: string
  users: number
  minimumFollowers: number
  leaders: {
    followers: LeaderEntry
    totalContributions: LeaderEntry
    publicContributions: LeaderEntry
  }
}

export interface CountryEntry {
  slug: string
  snapshot: Snapshot
}

export type MetricKey = 'followers' | 'publicContributions' | 'totalContributions'

export interface MetricDef {
  key: MetricKey
  label: string
  short: string
  sortAttr: string
  description: string
}

export const METRICS: MetricDef[] = [
  {
    key: 'followers',
    label: 'Followers',
    short: 'Followers',
    sortAttr: 'data-f',
    description: 'Lifetime follower count on the GitHub profile.',
  },
  {
    key: 'publicContributions',
    label: 'Public contributions',
    short: 'Public',
    sortAttr: 'data-p',
    description: 'Contribution calendar total minus restricted and private contributions.',
  },
  {
    key: 'totalContributions',
    label: 'Total contributions',
    short: 'Total',
    sortAttr: 'data-t',
    description: 'Contribution calendar total for the last year, including private contributions.',
  },
]

/* ------------------------------------------------------------------ */
/* Paths and caching                                                   */
/* ------------------------------------------------------------------ */

/**
 * Locate the repo's data/ directory. The build prerenders from bundled chunks
 * under dist/.prerender, so import.meta.url based resolution is unreliable;
 * the working directory during every supported invocation (astro build, astro
 * dev, astro check) is the site package or a nested folder of the repo, so
 * walk upward until data/current is found.
 */
function resolveDataRoot(): string {
  let dir = process.cwd()
  for (let steps = 0; steps < 8; steps += 1) {
    if (fs.existsSync(path.join(dir, 'data', 'current'))) return path.join(dir, 'data')
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('resolveDataRoot: could not locate a data/current directory above the working directory')
}

const dataRoot = resolveDataRoot()

const snapshotCache = new Map<string, Snapshot>()
const historyCache = new Map<string, HistoryLine[]>()

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function fail(file: string, message: string): never {
  throw new Error(`Invalid data in ${file}: ${message}`)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateSnapshot(slug: string, parsed: unknown): Snapshot {
  const file = `data/current/${slug}.json`
  if (typeof parsed !== 'object' || parsed === null) fail(file, 'not an object')
  const snap = parsed as Record<string, unknown>
  for (const key of ['country', 'geoName', 'collectedAt']) {
    if (typeof snap[key] !== 'string' || (snap[key] as string).length === 0) {
      fail(file, `${key} must be a non-empty string`)
    }
  }
  if (!Array.isArray(snap.cities)) fail(file, 'cities must be an array')
  if (!isFiniteNumber(snap.minimumFollowers)) fail(file, 'minimumFollowers must be a number')
  if (!Array.isArray(snap.users)) fail(file, 'users must be an array')
  for (const user of snap.users as unknown[]) {
    if (typeof user !== 'object' || user === null) fail(file, 'user entry must be an object')
    const u = user as Record<string, unknown>
    if (typeof u.login !== 'string' || u.login.length === 0) fail(file, 'user.login must be a string')
    if (!isFiniteNumber(u.followers)) fail(file, `user ${u.login}: followers must be a number`)
    if (!isFiniteNumber(u.totalContributions)) fail(file, `user ${u.login}: totalContributions must be a number`)
    if (!isFiniteNumber(u.publicContributions)) fail(file, `user ${u.login}: publicContributions must be a number`)
    if (typeof u.avatarUrl !== 'string' || u.avatarUrl.length === 0) fail(file, `user ${u.login}: avatarUrl must be a string`)
  }
  return snap as unknown as Snapshot
}

function validateHistoryLine(slug: string, parsed: unknown): HistoryLine {
  const file = `data/history/${slug}.jsonl`
  if (typeof parsed !== 'object' || parsed === null) fail(file, 'line is not an object')
  const line = parsed as Record<string, unknown>
  if (typeof line.date !== 'string') fail(file, 'date must be a string')
  if (typeof line.collectedAt !== 'string') fail(file, 'collectedAt must be a string')
  if (!isFiniteNumber(line.users)) fail(file, 'users must be a number')
  if (!isFiniteNumber(line.minimumFollowers)) fail(file, 'minimumFollowers must be a number')
  const leaders = line.leaders
  if (typeof leaders !== 'object' || leaders === null) fail(file, 'leaders must be an object')
  for (const key of ['followers', 'totalContributions', 'publicContributions']) {
    const entry = (leaders as Record<string, unknown>)[key] as Record<string, unknown> | undefined
    if (typeof entry !== 'object' || entry === null) fail(file, `leaders.${key} must be an object`)
    if (typeof entry.login !== 'string') fail(file, `leaders.${key}.login must be a string`)
    if (!isFiniteNumber(entry.value)) fail(file, `leaders.${key}.value must be a number`)
  }
  return line as unknown as HistoryLine
}

/* ------------------------------------------------------------------ */
/* Loaders                                                             */
/* ------------------------------------------------------------------ */

export function listSlugs(): string[] {
  const dir = path.join(dataRoot, 'current')
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort()
}

export function readSnapshot(slug: string): Snapshot {
  const cached = snapshotCache.get(slug)
  if (cached) return cached
  const file = path.join(dataRoot, 'current', `${slug}.json`)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`readSnapshot: cannot read or parse ${file}`, { cause: error })
  }
  const snapshot = validateSnapshot(slug, parsed)
  snapshotCache.set(slug, snapshot)
  return snapshot
}

/** One entry per collection day. A missing or empty history yields []. */
export function readHistory(slug: string): HistoryLine[] {
  const cached = historyCache.get(slug)
  if (cached) return cached
  const file = path.join(dataRoot, 'history', `${slug}.jsonl`)
  if (!fs.existsSync(file)) {
    historyCache.set(slug, [])
    return []
  }
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const parsed: HistoryLine[] = []
  for (const [index, line] of lines.entries()) {
    try {
      parsed.push(validateHistoryLine(slug, JSON.parse(line)))
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid data')) throw error
      throw new Error(`readHistory: cannot parse ${file} line ${index + 1}`, { cause: error })
    }
  }
  historyCache.set(slug, parsed)
  return parsed
}

/** All countries ordered alphabetically by display name. */
export function listCountries(): CountryEntry[] {
  return listSlugs()
    .map((slug) => ({ slug, snapshot: readSnapshot(slug) }))
    .sort((a, b) => a.snapshot.geoName.localeCompare(b.snapshot.geoName, 'en'))
}

export interface GlobalStats {
  countries: number
  entries: number
  cityTerms: number
  collectedAt: string
}

let statsCache: GlobalStats | null = null

/** Aggregate truth computed from every snapshot on disk. */
export function globalStats(): GlobalStats {
  if (statsCache) return statsCache
  const countries = listCountries()
  let entries = 0
  let cityTerms = 0
  let latest = ''
  for (const { snapshot } of countries) {
    entries += snapshot.users.length
    cityTerms += snapshot.cities.length
    const time = Date.parse(snapshot.collectedAt)
    if (Number.isNaN(time)) throw new Error(`globalStats: unparsable collectedAt for ${snapshot.geoName}`)
    if (latest === '' || time > Date.parse(latest)) latest = snapshot.collectedAt
  }
  const stats: GlobalStats = { countries: countries.length, entries, cityTerms, collectedAt: latest }
  statsCache = stats
  return stats
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

export interface RankedUser {
  user: SnapshotUser
  /** Competition ranking: ties share a rank, the next rank skips. */
  rank: number
}

function compareUsers(metric: MetricKey) {
  return (a: SnapshotUser, b: SnapshotUser): number => {
    if (b[metric] !== a[metric]) return b[metric] - a[metric]
    if (b.followers !== a.followers) return b.followers - a.followers
    return a.login.localeCompare(b.login, 'en')
  }
}

/**
 * The tracked set ordered by one metric with deterministic tiebreaks.
 * Equal metric values share a competition rank.
 */
export function rankedUsers(snapshot: Snapshot, metric: MetricKey): RankedUser[] {
  const sorted = [...snapshot.users].sort(compareUsers(metric))
  const rows: RankedUser[] = []
  let previousValue: number | null = null
  let previousRank = 0
  for (const [index, user] of sorted.entries()) {
    const value = user[metric]
    const rank = previousValue !== null && value === previousValue ? previousRank : index + 1
    rows.push({ user, rank })
    previousValue = value
    previousRank = rank
  }
  return rows
}

export function leadersOf(history: HistoryLine[]): { followers: LeaderEntry; totalContributions: LeaderEntry; publicContributions: LeaderEntry } | null {
  const last = history[history.length - 1]
  return last ? last.leaders : null
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const numberFormat = new Intl.NumberFormat('en-US')
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export function formatDay(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) throw new Error(`formatDay: unparsable date ${iso}`)
  return dayFormat.format(time)
}

/** "são-paulo" and " Lusaka" style config values become display labels. */
export function cityLabel(city: string): string {
  return city
    .trim()
    .split('-')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/** Search text with diacritics folded so "Côte d'Ivoire" matches "cote". */
export function foldToAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Join a path onto the configured base, tolerating a trailing slash in BASE_URL.
 * The site root normalizes to the base itself, never to a trailing slash.
 */
export function withBase(pathname: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')
  if (pathname === '' || pathname === '/') return base
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${suffix}`
}

/** Anchor link to a home section that works from every route. */
export function homeAnchor(id: string, isHome: boolean): string {
  return isHome ? `#${id}` : `${withBase('')}#${id}`
}

/** Link to a GitHub profile, tolerating any characters the data carries. */
export function githubProfileUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`
}
