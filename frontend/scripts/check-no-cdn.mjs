/** Fails the build if jsdelivr appears anywhere in dist/: Vidstack's CDN
 * fallbacks for hls.js and dash.js must never ship (see vite.config.ts).
 * Runs as npm postbuild; node scripts/check-no-cdn.mjs [dir] checks another dir.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
const hits = []
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue
  const path = join(entry.parentPath, entry.name)
  if ((await readFile(path)).includes('jsdelivr')) hits.push(path)
}
if (hits.length > 0) {
  console.error(`jsdelivr found in ${hits.length} built file(s):\n${hits.join('\n')}`)
  process.exit(1)
}
console.log(`check-no-cdn: no jsdelivr in ${root}`)
