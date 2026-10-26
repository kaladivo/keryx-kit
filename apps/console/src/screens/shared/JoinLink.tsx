import type { Channel } from '@keryx-kit/api'
import { Effect } from 'effect'
import { useEffect, useMemo, useState } from 'react'
import { call } from '../../lib/api.ts'
import { buildJoinUrl, newsletterSnippet, qrInfo, qrPng, qrSvg } from '../../lib/join.ts'
import { searchParam } from '../../lib/router.tsx'
import { useAsync } from '../../lib/useAsync.ts'
import { Card, CopyButton, Loading, Notice, Page } from '../../ui/kit.tsx'

type ChannelData = typeof Channel.Type

const download = (href: string, name: string) => {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** mvp-spec D1: join URL, QR (PNG and SVG) and newsletter snippet, built in the browser. */
export const JoinLink = () => {
  const data = useAsync(async () => {
    const [company, channels] = await Promise.all([
      call((api) => api.company.get()),
      call((api) => api.channels.list()),
    ])
    return { company, channels: channels.filter((c: ChannelData) => c.status === 'live') }
  }, [])
  const [selected, setSelected] = useState<ReadonlyArray<string>>(() => {
    const initial = searchParam('channel')
    return initial ? [initial] : []
  })
  const [svg, setSvg] = useState<string>()

  const origin = data.data?.company.joinOrigin
  const url = useMemo(
    () =>
      origin === undefined
        ? undefined
        : Effect.runSync(Effect.result(buildJoinUrl(origin, selected))),
    [origin, selected],
  )
  const joinUrl = url?._tag === 'Success' ? url.success : undefined
  useEffect(() => {
    if (joinUrl) void qrSvg(joinUrl).then(setSvg)
  }, [joinUrl])

  if (data.error)
    return (
      <Page title="Join link">
        <Notice tone="danger">{data.error.message}</Notice>
      </Page>
    )
  if (!data.data)
    return (
      <Page title="Join link">
        <Loading />
      </Page>
    )
  const { company, channels } = data.data
  const info = joinUrl ? qrInfo(joinUrl) : undefined
  const snippet = joinUrl ? newsletterSnippet(joinUrl) : ''

  return (
    <Page
      title="Join link and QR code"
      lead="Put it in a newsletter, on a receipt or on your website. Subscribers scan it, confirm your domain and pick channels. Nothing is subscribed without their tap."
    >
      {company.domain.status !== 'live' && (
        <Notice tone="warn" title="Your domain is not live yet">
          The link only works once the join kit is on {new URL(company.joinOrigin).host}. You can
          prepare it now.
        </Notice>
      )}
      <div className="split">
        <div className="stack">
          <Card title="Preselected channels">
            {channels.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No live channels yet. The link still pairs subscribers with your company.
              </p>
            ) : (
              <fieldset className="choices">
                <legend className="visually-hidden">Channels to preselect</legend>
                {channels.map((channel) => (
                  <label className="choice" key={channel.name}>
                    <input
                      type="checkbox"
                      checked={selected.includes(channel.name)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, channel.name]
                            : selected.filter((c) => c !== channel.name),
                        )
                      }
                    />
                    <span>
                      {channel.displayName}
                      <small>{channel.description || channel.name}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="muted tiny" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              Preselected channels are suggestions in the app’s consent screen; the subscriber still
              taps to subscribe.
            </p>
          </Card>
          <Card title="Join URL" aside={joinUrl && <CopyButton text={joinUrl} />}>
            {url?._tag === 'Failure' ? (
              <Notice tone="danger">{url.failure.message}</Notice>
            ) : (
              <p className="code-block" data-testid="join-url">
                {joinUrl}
              </p>
            )}
          </Card>
          <Card
            title="Newsletter snippet"
            aside={snippet && <CopyButton text={snippet} label="Copy HTML" />}
          >
            <p className="muted small">
              A button plus a link to the page that explains Keryx to your customers. Paste it into
              your newsletter tool’s HTML block.
            </p>
            {snippet && (
              <>
                <div
                  className="snippet-preview"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: our own generated snippet with an escaped URL
                  dangerouslySetInnerHTML={{ __html: snippet }}
                />
                <details>
                  <summary>Show HTML</summary>
                  <pre className="code-block">{snippet}</pre>
                </details>
              </>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="QR code">
            {svg && joinUrl && (
              <div className="stack-small">
                <div className="qr">
                  <img src={svgDataUrl(svg)} alt={`QR code for ${joinUrl}`} />
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="button button-small"
                    onClick={async () =>
                      download(await qrPng(joinUrl), `keryx-join-${company.slug}.png`)
                    }
                  >
                    Download PNG
                  </button>
                  <button
                    type="button"
                    className="button button-small button-quiet"
                    onClick={() => download(svgDataUrl(svg), `keryx-join-${company.slug}.svg`)}
                  >
                    Download SVG
                  </button>
                </div>
                {info && (
                  <p className="muted tiny" style={{ margin: 0 }}>
                    QR version {info.version}, {info.modules}×{info.modules} modules, error
                    correction Q.
                  </p>
                )}
                {info?.dense && (
                  <Notice tone="warn" title="This QR code is dense">
                    Receipt and dot-matrix printers often cannot print it sharply enough to scan.
                    Preselect fewer channels, or test with your printer before you print.
                  </Notice>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  )
}
