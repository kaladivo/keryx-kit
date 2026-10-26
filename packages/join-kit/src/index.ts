import { readFileSync } from 'node:fs'

const readSource = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

export const PWA_URL = 'https://v1b3coder.github.io/keryx/'
export const EXPLAINER_URL = 'https://keryx-kit.roguedave.codes/subscribers'

/** The static `join/index.html` of the join kit, with the QR library inlined. */
export const joinPageHtml: string = readSource('./join.html').replace(
  '/* qrcode-generator */',
  () => readSource('./qrcode.min.js'),
)
