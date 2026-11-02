/**
 * Build-time copy of the pipeline snapshots into the site's public tree.
 *
 * Runs before `astro build` (wired as the `prebuild` script) so the built site
 * serves every raw snapshot at {base}/data/{slug}.json. Read only, never
 * rewrites the source files. Fails the build when a snapshot is missing.
 */
import { mkdir, copyFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.resolve(siteDir, '..', 'data', 'current')
const targetDir = path.resolve(siteDir, 'public', 'data')

const files = (await readdir(sourceDir))
  .filter((name) => name.endsWith('.json'))
  .sort()

if (files.length === 0) {
  throw new Error(`copy-data: no snapshot JSON files found in ${sourceDir}`)
}

// Cross-check snapshots against config.json: routes are derived from the
// snapshot directory alone, so a missing file would otherwise silently drop
// that country from the built site.
const config = JSON.parse(
  await readFile(path.resolve(siteDir, '..', 'config.json'), 'utf8'),
)
const slugify = (country) => country.trim().toLowerCase().replace(/\s+/g, '_')
const expectedSlugs = new Set(config.locations.map((location) => slugify(location.country)))
const sourceSlugs = new Set(files.map((name) => name.slice(0, -5)))
const missing = [...expectedSlugs].filter((slug) => !sourceSlugs.has(slug))
const unexpected = [...sourceSlugs].filter((slug) => !expectedSlugs.has(slug))
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `copy-data: snapshot/config mismatch. missing snapshots: [${missing.join(', ')}]; snapshots without a config entry: [${unexpected.join(', ')}]`,
  )
}

await mkdir(targetDir, { recursive: true })
const sourceNames = new Set(files)
for (const existing of await readdir(targetDir)) {
  if (existing.endsWith('.json') && !sourceNames.has(existing)) {
    await rm(path.join(targetDir, existing))
  }
}

let totalBytes = 0
for (const name of files) {
  const source = path.join(sourceDir, name)
  const target = path.join(targetDir, name)
  await copyFile(source, target)
  totalBytes += (await stat(target)).size
}

console.log(`copy-data: ${files.length} snapshots -> public/data (${(totalBytes / 1e6).toFixed(1)} MB)`)
