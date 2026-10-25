/**
 * Build-time copy of the pipeline snapshots into the site's public tree.
 *
 * Runs before `astro build` (wired as the `prebuild` script) so the built site
 * serves every raw snapshot at {base}/data/{slug}.json. Read only, never
 * rewrites the source files. Fails the build when a snapshot is missing.
 */
import { mkdir, copyFile, readdir, rm, stat } from 'node:fs/promises'
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
