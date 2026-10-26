/** `install-kit [zip]`: puts a join kit on the website, deploys it and checks it is live. */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { ORIGIN } from './check.ts'
import { anchorFiles, installKit, kitCompany, kitFromZip, newestDownloadedKit } from './kit.ts'
import { publish } from './publish.ts'
import { bold, dim, done, fail } from './ui.ts'

const minutesAgo = (path: string) => {
  const minutes = Math.round((Date.now() - statSync(path).mtimeMs) / 60_000)
  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

const explicitZip = process.argv[2]
const zipPath =
  explicitZip ??
  newestDownloadedKit() ??
  fail('No keryx-join-kit-*.zip in ~/Downloads. Download the kit in the console first.')

console.log(`${bold(`Installing the Keryx join kit on ${ORIGIN}`)}\n`)
try {
  const kit = kitFromZip(new Uint8Array(readFileSync(zipPath)))
  const company = kitCompany(kit)
  if (!explicitZip && !company?.includes('coffee')) {
    fail(`The newest kit in ~/Downloads is for "${company}". Pass the coffee kit's path.`)
  }
  const roots = anchorFiles(kit)
  console.log(
    `  ${dim('zip    ')} ${zipPath.replace(homedir(), '~')} ${dim(`(${minutesAgo(zipPath)})`)}`,
  )
  console.log(`  ${dim('company')} ${bold(company ?? 'unknown')}`)
  console.log(`  ${dim('files  ')} ${roots.length} root files and join/index.html`)
  console.log('')
  installKit(kit)
  done('Copied the kit into public/')
} catch (error) {
  fail(`${zipPath}: ${error instanceof Error ? error.message : String(error)}`)
}
await publish(
  'The kit is live. Click "Check now" in the console.',
  'The kit is not live yet. Fix the red lines and run install-kit again.',
)
