import { parseJoinUrl } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildJoinUrl, EXPLAINER_URL, newsletterSnippet, qrInfo, qrSvg } from '../src/lib/join.ts'

describe('join link', () => {
  it('preselects the chosen channels in a URL the app parses', () => {
    const url = Effect.runSync(buildJoinUrl('https://shop.example.com', ['offers', 'news']))
    expect(url).toMatch(/^https:\/\/shop\.example\.com\/join\?p=[A-Za-z0-9_-]+$/)
    const parsed = Effect.runSync(parseJoinUrl(url))
    expect(parsed.origin).toBe('https://shop.example.com')
    expect(parsed.payload.channels).toEqual(['offers', 'news'])
  })

  it('refuses a non-HTTPS origin', () => {
    expect(Effect.runSync(Effect.result(buildJoinUrl('http://shop.example.com', [])))._tag).toBe(
      'Failure',
    )
  })

  it('warns about dense QR codes', () => {
    const short = Effect.runSync(buildJoinUrl('https://shop.example.com', ['offers']))
    expect(qrInfo(short).dense).toBe(false)
    const channels = Array.from({ length: 14 }, (_, i) => `channel-number-${i}`)
    const long = Effect.runSync(buildJoinUrl('https://shop.example.com', channels))
    expect(qrInfo(long)).toMatchObject({ dense: true })
    expect(qrInfo(long).version).toBeGreaterThanOrEqual(10)
  })

  it('renders an SVG QR', async () => {
    expect(await qrSvg('https://shop.example.com/join')).toMatch(/^<svg[\s\S]*<\/svg>\s*$/)
  })
})

describe('newsletter snippet', () => {
  const url = 'https://shop.example.com/join?p=eyJ2IjoxfQ'

  it('links the join URL and the subscriber explainer page', () => {
    const html = newsletterSnippet(url)
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain(`href="${EXPLAINER_URL}"`)
    expect(EXPLAINER_URL).toBe('https://keryx-kit.roguedave.codes/subscribers')
  })

  it('escapes the URL and names no company', () => {
    const html = newsletterSnippet('https://shop.example.com/join?p=a"><script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('carries only inline styles, no scripts', () => {
    const html = newsletterSnippet(url)
    expect(html).not.toMatch(/<script|<style|class=/)
  })
})
