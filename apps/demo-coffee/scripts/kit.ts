import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

export const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC_DIR = join(APP_DIR, 'public')
const COMING_SOON = join(APP_DIR, 'src/join-coming-soon.html')

export const ANCHOR_DIR = '.well-known/keryx'
export const ROOT_FILE = `${ANCHOR_DIR}/root.json`
export const JOIN_PAGE = 'join/index.html'

/** Files served from `public/`: path relative to it (as in the kit zip) to bytes. */
export type SiteFiles = Readonly<Record<string, Uint8Array>>

const isKitFile = (name: string) => name === JOIN_PAGE || /^\.well-known\/keryx\/[^/]+$/.test(name)

/** The files of a join kit zip (mvp-spec A3) that the website serves; the README stays out. */
export const kitFromZip = (zip: Uint8Array): SiteFiles => {
  const files = unzipSync(zip, { filter: (file) => isKitFile(file.name) })
  if (!files[ROOT_FILE] || !files[JOIN_PAGE]) {
    throw new Error(`Not a Keryx join kit: it has no ${ROOT_FILE} or ${JOIN_PAGE}.`)
  }
  return files
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

/** The company slug: the last segment of the repo base that root.json names. */
export const kitCompany = (kit: SiteFiles): string | undefined => {
  const bytes = kit[ROOT_FILE]
  if (!bytes) return undefined
  try {
    const root: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const repoBase = field(field(field(root, 'signed'), 'custom'), 'repo_base')
    return typeof repoBase === 'string' ? repoBase.split('/').filter(Boolean).at(-1) : undefined
  } catch {
    return undefined
  }
}

export const anchorFiles = (files: SiteFiles): ReadonlyArray<string> =>
  Object.keys(files).filter((file) => file.startsWith(`${ANCHOR_DIR}/`))

/** The newest `keryx-join-kit-*.zip` in ~/Downloads, as the console names its download. */
export const newestDownloadedKit = (): string | undefined => {
  const downloads = join(homedir(), 'Downloads')
  if (!existsSync(downloads)) return undefined
  return readdirSync(downloads)
    .filter((file) => /^keryx-join-kit-.+\.zip$/.test(file))
    .map((file) => join(downloads, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

const writeFile = (file: string, bytes: Uint8Array) => {
  const path = join(PUBLIC_DIR, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

const removeAnchor = () => rmSync(join(PUBLIC_DIR, ANCHOR_DIR), { recursive: true, force: true })

const comingSoon = () => copyFileSync(COMING_SOON, join(PUBLIC_DIR, JOIN_PAGE))

/** Replaces whatever kit is installed, so root files of an earlier kit do not linger. */
export const installKit = (kit: SiteFiles): void => {
  removeAnchor()
  for (const [file, bytes] of Object.entries(kit)) writeFile(file, bytes)
}

/** Back to the state before onboarding: no root files and a "coming soon" join page. */
export const resetKit = (): void => {
  removeAnchor()
  mkdirSync(join(PUBLIC_DIR, 'join'), { recursive: true })
  comingSoon()
}

/** A fresh checkout has no join page, as kit files are not committed. */
export const ensureJoinPage = (): void => {
  if (!existsSync(join(PUBLIC_DIR, JOIN_PAGE))) resetKit()
}

/** The kit files `public/` holds now: the join page and any root files. */
export const installedFiles = (): SiteFiles => {
  const anchorDir = join(PUBLIC_DIR, ANCHOR_DIR)
  const anchors = existsSync(anchorDir) ? readdirSync(anchorDir) : []
  return Object.fromEntries(
    [JOIN_PAGE, ...anchors.map((name) => `${ANCHOR_DIR}/${name}`)].map((file) => [
      file,
      new Uint8Array(readFileSync(join(PUBLIC_DIR, file))),
    ]),
  )
}
