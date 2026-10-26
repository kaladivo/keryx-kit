/** Join link, QR and newsletter snippet (mvp-spec D1, spec/core.md §3). */
import { joinPayload, joinUrl } from '@keryx-kit/domain'
import { Effect } from 'effect'
import QRCode from 'qrcode'

export const EXPLAINER_URL = 'https://keryx-kit.roguedave.codes/subscribers'

/** `https://<origin>/join?p=…` with the chosen channels preselected (never auto-subscribed). */
export const buildJoinUrl = (origin: string, channels: ReadonlyArray<string>) =>
  Effect.flatMap(joinPayload({ channels }), (payload) => joinUrl(origin, payload))

/** ECC Q, as spec/core.md §3 sizes it. */
const QR_OPTIONS = { errorCorrectionLevel: 'Q', margin: 4 } as const

/**
 * Above version 9 (53×53 modules) dot-matrix receipt printers often fail to print a
 * scannable code (spec/core.md §3 size policy).
 */
export const DENSE_QR_VERSION = 10

export interface QrInfo {
  readonly version: number
  readonly modules: number
  readonly dense: boolean
}

export const qrInfo = (url: string): QrInfo => {
  const qr = QRCode.create(url, QR_OPTIONS)
  return {
    version: qr.version,
    modules: qr.modules.size,
    dense: qr.version >= DENSE_QR_VERSION,
  }
}

export const qrSvg = (url: string): Promise<string> =>
  QRCode.toString(url, { ...QR_OPTIONS, type: 'svg', color: { dark: '#000000', light: '#ffffff' } })

export const qrPng = (url: string): Promise<string> =>
  QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1024 })

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A button plus a link to the explainer page, with inline styles because newsletter
 * tools strip stylesheets. It names no company: the app shows the verified identity.
 */
export const newsletterSnippet = (url: string): string => {
  const href = escapeHtml(url)
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background:#0000ee;">',
    `<a href="${href}" style="display:inline-block;padding:12px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Get our announcements in Keryx</a>`,
    '</td></tr></table>',
    `<p style="margin:12px 0 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#57534a;">No email address or account needed. <a href="${EXPLAINER_URL}" style="color:#0000ee;">How Keryx works and why it is safe</a>.</p>`,
  ].join('\n')
}
