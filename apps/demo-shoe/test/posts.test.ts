import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const POSTS_DIR = new URL('../posts/', import.meta.url)
const CHANNELS = ['news', 'security']
const SLUG = /^[a-z0-9_-]+$/
const MAX_IMAGE_BYTES = 150 * 1024
const MAX_POST_BYTES = 1024 * 1024

interface Post {
  readonly file: string
  readonly fields: Record<string, string>
  readonly body: string
}

const jpegSize = (bytes: Buffer) => {
  const isFrameHeader = (marker: number) => marker >= 0xc0 && marker <= 0xc3
  for (let at = 2; at < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    if (isFrameHeader(bytes[at + 1] ?? 0)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
    }
  }
  throw new Error('no JPEG frame header')
}

const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1')

const parsePost = (file: string): Post => {
  const text = readFileSync(new URL(file, POSTS_DIR), 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match?.[1] || !match[2]) throw new Error(`${file} has no front matter`)
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const colon = line.indexOf(': ')
      return [line.slice(0, colon), unquote(line.slice(colon + 2))]
    }),
  )
  return { file, fields, body: match[2] }
}

const posts = readdirSync(POSTS_DIR)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .map(parsePost)

describe('posts', () => {
  it('has four posts per channel', () => {
    for (const channel of CHANNELS) {
      expect(posts.filter((post) => post.fields.channel === channel)).toHaveLength(4)
    }
  })

  it.each(posts)('$file has valid front matter', ({ fields }) => {
    expect(Object.keys(fields).sort()).toEqual(
      ['channel', 'id', 'image', 'language', 'tags', 'title'].sort(),
    )
    expect(CHANNELS).toContain(fields.channel)
    expect(fields.id).toMatch(SLUG)
    expect(fields.language).toBe('en')
    expect(fields.tags).toMatch(/^\[[a-z0-9-]+(, [a-z0-9-]+)*\]$/)
  })

  it('uses unique ids per channel', () => {
    const keys = posts.map((post) => `${post.fields.channel}/${post.fields.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(posts)('$file fits the size limits', ({ fields, body }) => {
    const imageBytes = statSync(new URL(fields.image ?? '', POSTS_DIR)).size
    expect(imageBytes).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
    const base64ImageBytes = Math.ceil(imageBytes / 3) * 4
    expect(base64ImageBytes + Buffer.byteLength(body)).toBeLessThan(MAX_POST_BYTES)
  })

  it.each(posts)('$file has a square 1080 px image, as the app crops to 1:1', ({ fields }) => {
    const image = readFileSync(new URL(fields.image ?? '', POSTS_DIR))
    expect(jpegSize(image)).toEqual({ width: 1080, height: 1080 })
  })

  it.each(posts)('$file has no HTML, forms or scripts', ({ body }) => {
    expect(body).not.toMatch(/<[a-z]/i)
  })
})
