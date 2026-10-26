import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * The subscriber app's sanitizer configuration, copied from
 * `vendor/keryx/app/src/ui/SanitizedHtml.tsx` (a test keeps the two in sync). Running
 * the editor's `content_html` and preview through it means what the author sees is
 * what subscribers see.
 */
export const SUBSCRIBER_SANITIZER = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'code',
    'pre',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
    'div',
    'hr',
    'small',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'form',
    'input',
    'button',
    'object',
    'embed',
    'link',
    'meta',
    'svg',
    'math',
  ],
}

export const sanitizeHtml = (html: string): string => DOMPurify.sanitize(html, SUBSCRIBER_SANITIZER)

/** Markdown to the `content_html` that gets signed: rendered, then sanitized. */
export const markdownToHtml = (markdown: string): string =>
  sanitizeHtml(marked.parse(markdown, { async: false, gfm: true, breaks: false }))

const DATA_IMAGE = /\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g
const IMAGE_TOKEN = /\]\((image:\d+)\)/g

/**
 * Inline images live in the Markdown as data URLs (that is what gets saved and
 * signed), but the editor shows short `image:N` tokens instead of kilobytes of base64.
 */
export const collapseImages = (
  markdown: string,
  images: Readonly<Record<string, string>> = {},
): { text: string; images: Record<string, string> } => {
  const found: Record<string, string> = { ...images }
  const known = new Map(Object.entries(found).map(([token, url]) => [url, token]))
  const text = markdown.replace(DATA_IMAGE, (_, url: string) => {
    let token = known.get(url)
    if (token === undefined) {
      token = `image:${Object.keys(found).length + 1}`
      found[token] = url
      known.set(url, token)
    }
    return `](${token})`
  })
  return { text, images: found }
}

export const expandImages = (text: string, images: Readonly<Record<string, string>>): string =>
  text.replace(IMAGE_TOKEN, (match, token: string) => {
    const url = images[token]
    return url === undefined ? match : `](${url})`
  })
