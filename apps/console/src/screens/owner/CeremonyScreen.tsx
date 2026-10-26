import type { CeremonySummary } from '@keryx-kit/api'
import { Effect } from 'effect'
import { type ReactNode, useEffect, useState } from 'react'
import { call } from '../../lib/api.ts'
import { wipe } from '../../lib/bytes.ts'
import { type ChangeLine, reviewCeremony, signCeremony } from '../../lib/ceremony.ts'
import { runEffect } from '../../lib/effect.ts'
import { deriveMasterSeed, masterKeyLabel } from '../../lib/masterKey.ts'
import { Link, navigate, searchParam } from '../../lib/router.tsx'
import { rememberTargetsVersion, seenTargetsVersion } from '../../lib/seenVersions.ts'
import { trezorClient } from '../../lib/trezor.ts'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { ChangeIcon, TrezorIcon } from '../../ui/icons.tsx'
import { Badge, Button, Card, ErrorText, Loading, Notice, Page } from '../../ui/kit.tsx'
import { useOwner } from './OwnerArea.tsx'

type Summary = typeof CeremonySummary.Type

const statusBadge: Record<Summary['status'], ReactNode> = {
  'awaiting-owner': <Badge tone="warn">Waiting for your signature</Badge>,
  staged: <Badge tone="warn">Signed, waiting for an author</Badge>,
  applied: <Badge tone="success">Live</Badge>,
  discarded: <Badge>Discarded</Badge>,
}

const ChangeLines = ({ lines }: { readonly lines: ReadonlyArray<ChangeLine> }) => (
  <ul className="change-list">
    {lines.map((line) => (
      <li key={line.text}>
        <ChangeIcon kind={line.kind} />
        <div>
          <strong>{line.text}</strong>
          {line.detail && <p>{line.detail}</p>}
          {line.logo && (
            <img
              className="logo logo-large"
              src={line.logo}
              alt="New logo"
              style={{ marginTop: '0.5rem' }}
            />
          )}
          {line.items && (
            <ul className="small" style={{ margin: '0.35rem 0 0' }}>
              {line.items.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          )}
          {line.keys && line.keys.length > 0 && (
            <ul className="key-lines">
              {line.keys.map((key) => (
                <li key={`${key.kind}-${key.fingerprint}`}>
                  <code className="fingerprint">{key.fingerprint}</code>
                  <span>
                    {key.kind === 'channel'
                      ? 'Channel key (held by the server)'
                      : `${key.name ?? 'Unknown member'} · ${key.label}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </li>
    ))}
  </ul>
)

const MissingSignatures = ({ summary }: { readonly summary: Summary }) =>
  summary.status === 'staged' && summary.missing.length > 0 ? (
    <Notice tone="warn" title="Waiting for an author">
      {summary.missing.map((missing) => (
        <p key={missing.file}>
          <span className="mono">{missing.file}</span> needs a signature from{' '}
          {missing.signers.map((s) => s.name).join(' or ') || 'an author'}. Their console signs it
          automatically the next time they open it. Then the change goes live.
        </p>
      ))}
    </Notice>
  ) : null

const RemovalImpact = ({ summary }: { readonly summary: Summary }) => {
  const removal = summary.removal
  if (!removal || summary.status === 'applied' || summary.status === 'discarded') return null
  const items = removal.itemsSignedOnlyByAuthor
  return (
    <Card title="Before you remove this author">
      {items.length === 0 && !removal.authorsMetadataNeedsResign ? (
        <Notice tone="success">
          Every published post is also signed by a remaining author. Nothing will be unpublished.
        </Notice>
      ) : (
        <div className="stack-small">
          {items.length > 0 && (
            <>
              <p className="small">
                {items.length} published {items.length === 1 ? 'post is' : 'posts are'} signed only
                by this author. The remaining authors now have a{' '}
                <strong>
                  Re-sign {items.length} {items.length === 1 ? 'post' : 'posts'}
                </strong>{' '}
                task in their console. Posts nobody re-signs are unpublished when you sign, because
                subscriber apps would reject them.
              </p>
              <ul className="small" style={{ margin: 0 }}>
                {items.map((item) => (
                  <li key={item.id}>{item.title}</li>
                ))}
              </ul>
            </>
          )}
          {removal.authorsMetadataNeedsResign && (
            <p className="small">
              The channel’s author list was signed only by this author. A remaining author re-signs
              it automatically; until then the removal stays staged.
            </p>
          )}
          <p className="muted tiny">
            This list updates as authors re-sign. You can sign at any time.
          </p>
        </div>
      )}
    </Card>
  )
}

export const CeremonyScreen = ({ id }: { readonly id: string }) => {
  const { company, refresh } = useOwner()
  const [result, setResult] = useState<Summary>()
  const [signedLines, setSignedLines] = useState<ReadonlyArray<ChangeLine>>()
  const data = useAsync(async () => {
    const [ceremony, team] = await Promise.all([
      call((api) => api.ceremonies.get({ params: { ceremonyId: id } })),
      call((api) => api.team.get()),
    ])
    const review =
      ceremony.status === 'awaiting-owner'
        ? await Effect.runPromise(
            Effect.result(reviewCeremony(ceremony, team.members, seenTargetsVersion(company.slug))),
          )
        : undefined
    if (review?._tag === 'Success') rememberTargetsVersion(company.slug, review.success.baseVersion)
    return { ceremony, review }
  }, [id])
  useEffect(() => {
    void trezorClient().catch(() => undefined)
  }, [])

  const sign = useAction(async () => {
    const review = data.data?.review
    if (review?._tag !== 'Success') throw new Error('This change cannot be signed.')
    const trezor = await trezorClient()
    let seed: Uint8Array | undefined
    try {
      seed = await deriveMasterSeed(trezor, company.slug)
      const [first, ...rest] = await runEffect(signCeremony(review.success, seed))
      if (!first) throw new Error('Nothing to sign.')
      const summary = await call((api) =>
        api.ceremonies.sign({
          params: { ceremonyId: id },
          payload: { signatures: [first, ...rest] },
        }),
      )
      setResult(summary)
      setSignedLines(review.success.lines)
      const signedTargets = review.success.checks.find((check) => check.role === 'targets')
      if (summary.status === 'applied' && signedTargets)
        rememberTargetsVersion(company.slug, signedTargets.version)
    } finally {
      wipe(seed)
    }
    await Promise.all([refresh(), data.reload()])
  })

  const discard = useAction(async () => {
    await call((api) => api.ceremonies.discard({ params: { ceremonyId: id } }))
    navigate('/owner')
  })

  if (data.error)
    return (
      <Page title="Change">
        <Notice tone="danger">{data.error.message}</Notice>
      </Page>
    )
  if (!data.data)
    return (
      <Page title="Review the change">
        <Loading />
      </Page>
    )

  const { ceremony, review } = data.data
  const summary = result ?? ceremony
  const awaiting = summary.status === 'awaiting-owner'

  return (
    <Page
      back={{ to: '/owner', label: 'Overview' }}
      title={awaiting ? 'Review and sign' : 'Change'}
      lead="This browser rebuilt the change from the published repo. The summary below comes from that rebuild, not from the server."
      actions={statusBadge[summary.status]}
    >
      {searchParam('blocked') && awaiting && (
        <Notice tone="warn" title="Another change is already open">
          Finish or discard this one before you start a new change.
        </Notice>
      )}
      {summary.status === 'applied' && (
        <Notice tone="success" title="The change is live">
          Subscribers see it at their next sync. <Link to="/owner/channels">Back to channels</Link>
        </Notice>
      )}
      <MissingSignatures summary={summary} />

      <div className="split">
        <div className="stack">
          {review === undefined ? (
            <Card title={signedLines ? 'What you signed' : 'What changes'}>
              {signedLines ? (
                <ChangeLines lines={signedLines} />
              ) : (
                <p style={{ margin: 0 }}>{summary.summary}</p>
              )}
            </Card>
          ) : review._tag === 'Success' ? (
            <Card title="What changes">
              <ChangeLines lines={review.success.lines} />
              {review.success.lines.some((line) => line.keys?.some((k) => k.kind === 'author')) && (
                <p className="muted small" style={{ marginTop: '1rem' }}>
                  Compare each author fingerprint with the one the author sees in their own console
                  (Home → Your key). If one differs, do not sign: the server may have swapped a key.
                </p>
              )}
            </Card>
          ) : (
            <Notice tone="danger" title="Refused: this change was not signed">
              <p>{review.failure.reason}</p>
              <p>Discard it and start again. If it happens again, contact the operator.</p>
            </Notice>
          )}
          <RemovalImpact summary={summary} />
        </div>

        <div className="stack">
          {review?._tag === 'Success' && review.success.checks.length > 0 && !result && (
            <Card title="Byte comparison" aside={<Badge tone="success">Match</Badge>}>
              <div className="bytes">
                {review.success.checks.map((check) => (
                  <p key={check.file} className="small" style={{ margin: 0 }}>
                    <strong>{check.file}</strong> v{check.version}: the {check.length} bytes the
                    server asked to sign equal this browser’s rebuild.
                    <br />
                    <span className="mono muted tiny">SHA-256 {check.sha256.slice(0, 32)}…</span>
                  </p>
                ))}
              </div>
            </Card>
          )}

          {awaiting && review?._tag === 'Success' && (
            <Card title="Sign with your Trezor">
              <div className="hardware">
                <p className="small" style={{ margin: 0 }}>
                  One click opens Trezor Suite once. Approve the request, then confirm on the
                  device:
                </p>
                <div className="device-screen">
                  <span>Encrypt value</span>
                  {masterKeyLabel(company.slug)}
                </div>
                <p className="muted tiny" style={{ margin: 0 }}>
                  The browser derives your master key, checks it matches root.json, signs, and
                  erases it. Use the same Suite wallet as at sign-up.
                </p>
                <Button variant="hardware" busy={sign.busy} onClick={() => void sign.run()}>
                  <TrezorIcon />
                  Sign with Trezor
                </Button>
                <ErrorText error={sign.error} />
              </div>
            </Card>
          )}

          {(awaiting || summary.status === 'staged') && (
            <div className="row">
              <Button small variant="danger" busy={discard.busy} onClick={() => void discard.run()}>
                Discard this change
              </Button>
              {summary.status === 'staged' && (
                <Button small variant="quiet" onClick={() => void data.reload()}>
                  Refresh
                </Button>
              )}
            </div>
          )}
          <ErrorText error={discard.error} />
        </div>
      </div>
    </Page>
  )
}
