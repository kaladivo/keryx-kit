/**
 * Fails the build when `dist` breaks the console CSP (`script-src 'self'`: no inline
 * scripts, no eval) or carries dev-only code (mock API, Trezor stub).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')
const files = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  )

const problems: Array<string> = []
for (const file of files(dist)) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.html')) {
    for (const tag of text.match(/<script\b[^>]*>/g) ?? [])
      if (!/\bsrc=/.test(tag)) problems.push(`${file}: inline <script>`)
    if (/\son[a-z]+=/i.test(text)) problems.push(`${file}: inline event handler`)
  }
  if (file.endsWith('.js')) {
    if (/\bnew Function\(|\beval\(/.test(text)) problems.push(`${file}: eval`)
    for (const marker of ['keryx-stub-wallet', 'keryx-kit stub trezor', 'createMock'])
      if (text.includes(marker)) problems.push(`${file}: dev-only code (${marker})`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`dist ok: no inline scripts, no eval, no dev-only code`)
