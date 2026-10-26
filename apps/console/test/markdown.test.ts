import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collapseImages,
  expandImages,
  markdownToHtml,
  SUBSCRIBER_SANITIZER,
  sanitizeHtml,
} from '../src/lib/markdown.ts'

const appSanitizer = readFileSync(
  resolve(import.meta.dirname, '../../../vendor/keryx/app/src/ui/SanitizedHtml.tsx'),
  'utf8',
)

const listIn = (source: string, name: string): ReadonlyArray<string> => {
  const match = source.match(new RegExp(`${name}\\s*[=:]\\s*\\[([^\\]]*)\\]`))
  if (!match?.[1]) throw new Error(`${name} not found in the subscriber app`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
}

describe('sanitizer', () => {
  it('uses exactly the subscriber app configuration', () => {
    expect(SUBSCRIBER_SANITIZER.ALLOWED_TAGS).toEqual(listIn(appSanitizer, 'ALLOWED_TAGS'))
    expect(SUBSCRIBER_SANITIZER.ALLOWED_ATTR).toEqual(listIn(appSanitizer, 'ALLOWED_ATTR'))
    expect(SUBSCRIBER_SANITIZER.FORBID_TAGS).toEqual(listIn(appSanitizer, 'FORBID_TAGS'))
    expect(appSanitizer).toContain('ALLOW_DATA_ATTR: false')
  })

  it('strips scripts, forms, iframes, styles and event handlers', () => {
    const html = sanitizeHtml(
      '<p onclick="x()" style="color:red" class="c" data-x="1">Hi</p><script>alert(1)</script><form><input name="seed"></form><iframe src="https://evil.test"></iframe><svg><circle/></svg>',
    )
    expect(html).toBe('<p>Hi</p>')
  })

  it('keeps links and inline data images', () => {
    const html = sanitizeHtml(
      '<a href="https://shop.example.com" target="_blank" rel="noopener">shop</a><img src="data:image/png;base64,AAAA" alt="x">',
    )
    expect(html).toContain('href="https://shop.example.com"')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
  })

  it('drops javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })
})

describe('Markdown to content_html', () => {
  it('renders the usual Markdown', () => {
    const html = markdownToHtml(
      '# Sale\n\nEverything **20%** off, see [the shop](https://shop.example.com).\n\n- boots\n- jackets\n',
    )
    expect(html).toContain('<h1>Sale</h1>')
    expect(html).toContain('<strong>20%</strong>')
    expect(html).toContain('<a href="https://shop.example.com">the shop</a>')
    expect(html).toContain('<li>boots</li>')
  })

  it('sanitizes raw HTML written into the Markdown', () => {
    const html = markdownToHtml('Hello <script>alert(1)</script><form><input></form> world')
    expect(html).not.toMatch(/script|form|input/)
    expect(html).toContain('Hello')
  })

  it('shows short tokens for inline images and restores the data URLs', () => {
    const url = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    const markdown = `Look ![shoes](${url}) and again ![same](${url})`
    const { text, images } = collapseImages(markdown)
    expect(text).toBe('Look ![shoes](image:1) and again ![same](image:1)')
    expect(expandImages(text, images)).toBe(markdown)
    expect(markdownToHtml(expandImages(text, images))).toContain(`src="${url}"`)
  })
})
