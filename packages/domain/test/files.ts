import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { RepoFiles } from '../src/index.ts'

const readTree = (root: string): Record<string, Uint8Array> => {
  const out: Record<string, Uint8Array> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else out[relative(root, path)] = new Uint8Array(readFileSync(path))
    }
  }
  walk(root)
  return out
}

export const readRepoDir = (dir: string): RepoFiles => ({
  anchor: readTree(join(dir, 'anchor')),
  base: readTree(join(dir, 'base')),
})

const decoder = new TextDecoder()

/** Files as text, for readable diffs. */
export const asText = (files: Readonly<Record<string, Uint8Array>>, only?: ReadonlyArray<string>) =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => !only || only.includes(path))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, bytes]) => [path, decoder.decode(bytes)]),
  )
