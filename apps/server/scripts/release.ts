/**
 * `bun scripts/release.ts <console dist> <git sha>` prints release.json (mvp-spec §5.9):
 * the SHA-256 of a manifest of `sha256  path` lines, one per built console file, sorted by
 * path. Anyone can rebuild the console at that commit and compare.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const [dir, gitSha = 'dev'] = process.argv.slice(2)
if (!dir) throw new Error('usage: release.ts <console dist> <git sha>')

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

const files = (() => {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .map((entry) => join(dir, entry))
      .filter((path) => statSync(path).isFile())
  } catch {
    return []
  }
})()

const manifest = files
  .map((path) => [relative(dir, path).split('\\').join('/'), sha256(readFileSync(path))] as const)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([path, hash]) => `${hash}  ${path}\n`)
  .join('')

console.log(
  JSON.stringify({ gitSha, consoleBundleSha256: sha256(manifest), files: files.length, manifest }),
)
