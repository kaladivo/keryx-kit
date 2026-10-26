import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { EXPLAINER_URL, joinPageHtml, PWA_URL } from '../src/index.ts'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

const windows: Window[] = []

const openJoinPage = (url: string) => {
  const window = new Window({
    url,
    settings: {
      enableJavaScriptEvaluation: true,
      // Only our own template runs here.
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  })
  windows.push(window)
  window.document.write(joinPageHtml)
  return window.document
}

const openInKeryxHref = (url: string) =>
  openJoinPage(url).getElementById('open')?.getAttribute('href')

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()))
})

describe('join page template', () => {
  it('references no URL other than the PWA and the explainer page', () => {
    const urls = joinPageHtml.match(/https?:\/\/[^\s"'<>)]+/g) ?? []
    const allowed = new Set([PWA_URL, EXPLAINER_URL, SVG_NAMESPACE])
    expect(urls.filter((url) => !allowed.has(url))).toEqual([])
    const markup = joinPageHtml.replace(/<script>[\s\S]*?<\/script>/g, '')
    expect(markup).not.toMatch(/(src|href)=["']\/\//)
    expect(markup).not.toMatch(/<(link|iframe|img|object|embed)\b/i)
    expect(markup).not.toMatch(/<script[^>]+src=/i)
    expect(markup).not.toMatch(/@import|url\(/)
  })

  it('sets the no-referrer policy', () => {
    expect(joinPageHtml).toContain('<meta name="referrer" content="no-referrer">')
  })

  it('links the explainer page', () => {
    expect(joinPageHtml).toContain(`href="${EXPLAINER_URL}"`)
  })

  it('inlines the QR library', () => {
    expect(joinPageHtml).not.toContain('/* qrcode-generator */')
    expect(joinPageHtml).toContain('var qrcode=function()')
  })
})

describe('Open in Keryx link', () => {
  it.each([
    [
      'https://acme.com/join?p=eyJ2IjoxLCJjaGFubmVscyI6WyJvZmZlcnMiXX0',
      `${PWA_URL}?domain=acme.com&p=eyJ2IjoxLCJjaGFubmVscyI6WyJvZmZlcnMiXX0`,
    ],
    [
      'https://news.shop.example/join/?p=abc_-123',
      `${PWA_URL}?domain=news.shop.example&p=abc_-123`,
    ],
    ['https://acme.com/join', `${PWA_URL}?domain=acme.com`],
    ['https://acme.com:8443/join?p=eyJ2IjoxfQ', `${PWA_URL}?domain=acme.com%3A8443&p=eyJ2IjoxfQ`],
  ])('%s opens %s', (joinUrl, deepLink) => {
    expect(openInKeryxHref(joinUrl)).toBe(deepLink)
  })

  it('round-trips to the join URL the app rebuilds from the deep link', () => {
    const joinUrl = 'https://acme.com/join?p=eyJ2IjoxfQ'
    const deepLink = new URL(openInKeryxHref(joinUrl) ?? '')
    const domain = deepLink.searchParams.get('domain')
    const p = deepLink.searchParams.get('p')
    // Mirrors joinUrlFromDeepLink in vendor/keryx/app/src/lib/payload.ts
    expect(`https://${domain}/join?p=${p}`).toBe(joinUrl)
  })

  it('drops a p that is not base64url and warns about the damaged link', () => {
    const document = openJoinPage('https://acme.com/join?p=a%20b%26c')
    expect(document.getElementById('open')?.getAttribute('href')).toBe(`${PWA_URL}?domain=acme.com`)
    expect(document.getElementById('damaged')?.hasAttribute('hidden')).toBe(false)
  })

  it('shows no damaged-link warning for a valid link', () => {
    const document = openJoinPage('https://acme.com/join?p=eyJ2IjoxfQ')
    expect(document.getElementById('damaged')?.hasAttribute('hidden')).toBe(true)
  })
})

describe('page content', () => {
  it('shows the origin of the page itself', () => {
    const document = openJoinPage('https://acme.com/join?p=eyJ2IjoxfQ')
    expect(document.getElementById('origin')?.textContent).toBe('https://acme.com')
  })

  it('renders a QR code', () => {
    const document = openJoinPage('https://acme.com/join?p=eyJ2IjoxfQ')
    const path = document.querySelector('#qr svg path')
    expect(path?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/)
  })
})
