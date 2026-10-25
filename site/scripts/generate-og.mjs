#!/usr/bin/env node
/**
 * Generate a self-hosted social preview SVG from real build data. The counts
 * are computed from the same snapshots used to render the site.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const currentDir = path.resolve(siteDir, '..', 'data', 'current')
const publicDir = path.join(siteDir, 'public')
const files = (await readdir(currentDir)).filter((name) => name.endsWith('.json'))
let entries = 0
for (const file of files) {
  const snapshot = JSON.parse(await readFile(path.join(currentDir, file), 'utf8'))
  entries += snapshot.users.length
}
const countries = files.length
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const image = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#000000"/>
<rect x="60" y="60" width="1080" height="510" rx="18" fill="#0b0b0a" stroke="#30302b"/>
<text x="112" y="145" fill="#9a9488" font-family="sans-serif" font-size="16" letter-spacing="2">COUNTRY RANKINGS FROM GITHUB</text>
<circle cx="97" cy="139" r="5" fill="#31d158"/>
<text x="112" y="238" fill="#f4f1e8" font-family="sans-serif" font-size="56" font-weight="400" letter-spacing="-2">The world’s most</text>
<text x="112" y="303" fill="#d6a84f" font-family="sans-serif" font-size="56" font-weight="400" letter-spacing="-2">influential GitHub builders</text>
<text x="112" y="365" fill="#b8b2a4" font-family="sans-serif" font-size="22">Hourly country snapshots from the official GitHub API.</text>
<text x="112" y="510" fill="#9a9488" font-family="monospace" font-size="16">isyuricunha.github.io/top-github-users</text>
<rect x="810" y="420" width="145" height="90" rx="12" fill="#10100f" stroke="#30302b"/>
<text x="830" y="450" fill="#9a9488" font-family="monospace" font-size="12" letter-spacing="1">COUNTRIES</text>
<text x="830" y="485" fill="#f4f1e8" font-family="monospace" font-size="25">${esc(countries)}</text>
<rect x="970" y="420" width="145" height="90" rx="12" fill="#10100f" stroke="#30302b"/>
<text x="990" y="450" fill="#9a9488" font-family="monospace" font-size="12" letter-spacing="1">RANKED ENTRIES</text>
<text x="990" y="485" fill="#f4f1e8" font-family="monospace" font-size="25">${esc(new Intl.NumberFormat('en-US').format(entries))}</text>
</svg>`
await writeFile(path.join(publicDir, 'og.svg'), image, 'utf8')
console.log(`og-image: public/og.svg generated for ${countries} countries and ${entries} country-ranking entries`)
