import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { call, isUnauthorized } from '../../lib/api.ts'
import { navigate } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import {
  Badge,
  Button,
  Card,
  CopyButton,
  daysUntil,
  ErrorText,
  Field,
  formatDate,
  formatDateTime,
  Loading,
  Notice,
  Page,
} from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

const nav = [
  { to: '/operator', label: 'Companies', exact: true },
  { to: '/operator/codes', label: 'Invite codes' },
  { to: '/operator/pilots', label: 'Pilot requests' },
]

const logout = async () => {
  await call((api) => api.operator.logout())
  navigate('/operator/login')
}

export const OperatorArea = ({ children }: { readonly children: ReactNode }) => (
  <Shell
    home="/operator"
    nav={nav}
    account={
      <>
        <span>Operator</span>
        <Button small variant="quiet" onClick={() => void logout()}>
          Sign out
        </Button>
      </>
    }
  >
    {children}
  </Shell>
)

/** Redirects to the operator login when a call answers 401. */
const useOperatorData = <A,>(load: () => Promise<A>) => {
  const data = useAsync(load, [])
  useEffect(() => {
    if (isUnauthorized(data.error)) navigate('/operator/login', { replace: true })
  }, [data.error])
  return data
}

const domainTone = { live: 'success', mismatch: 'danger', 'not-set-up': 'warn' } as const

/**
 * Days left at which a file needs attention: people re-sign targets and authors metadata
 * (E3 reminds at 60 days); the server renews snapshot and channel metadata daily below 7
 * and 30 days (mvp-spec §5.8), so only an overdue renewal needs the operator.
 */
const attentionDays = { humanSigned: 60, snapshot: 6, channel: 29 } as const

const Expiry = ({
  iso,
  signer,
}: {
  readonly iso: string
  readonly signer: keyof typeof attentionDays
}) => {
  const days = daysUntil(iso)
  const attention = days <= attentionDays[signer]
  return (
    <span className={attention ? 'field-error' : undefined} title={iso}>
      {formatDate(iso)}
      {attention && ` (${days} d)`}
    </span>
  )
}

export const OperatorDashboard = () => {
  const data = useOperatorData(() => call((api) => api.operator.dashboard()))
  const companies = data.data?.companies ?? []
  const attention = companies.filter(
    (c) => c.domain.status === 'mismatch' || daysUntil(c.expires.targets) <= 60,
  )
  return (
    <Page
      title="Companies"
      lead="Domain status, freshness and the expiry of every signed metadata file."
    >
      {attention.length > 0 && (
        <Notice
          tone="warn"
          title={`${attention.length} ${attention.length === 1 ? 'company needs' : 'companies need'} attention`}
        >
          {attention.map((c) => (
            <p key={c.slug}>
              {c.name}:{' '}
              {[
                c.domain.status === 'mismatch'
                  ? `domain mismatch (${c.domain.reason ?? 'no reason'})`
                  : '',
                daysUntil(c.expires.targets) <= 60
                  ? `targets.json expires ${formatDate(c.expires.targets)}`
                  : '',
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          ))}
        </Notice>
      )}
      {data.loading && !data.data && <Loading />}
      {data.data && companies.length === 0 && <Card quiet>No companies yet.</Card>}
      {companies.map((c) => (
        <Card
          key={c.slug}
          title={c.name}
          aside={
            <Badge tone={domainTone[c.domain.status]}>{c.domain.status.replace(/-/g, ' ')}</Badge>
          }
        >
          <dl className="kv small">
            <dt>Slug</dt>
            <dd className="mono">{c.slug}</dd>
            <dt>Join origin</dt>
            <dd className="mono">{c.joinOrigin}</dd>
            <dt>Contact</dt>
            <dd>{c.contactEmail}</dd>
            <dt>Signed up</dt>
            <dd>{formatDate(c.createdAt)}</dd>
            <dt>Last timestamp</dt>
            <dd>{formatDateTime(c.lastTimestampAt)}</dd>
          </dl>
          <div className="table-scroll" style={{ marginTop: '1rem' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Metadata</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">root.json</td>
                  <td>
                    <Expiry iso={c.expires.root} signer="humanSigned" />
                  </td>
                </tr>
                <tr>
                  <td className="mono">targets.json</td>
                  <td>
                    <Expiry iso={c.expires.targets} signer="humanSigned" />
                  </td>
                </tr>
                <tr>
                  <td className="mono">snapshot.json</td>
                  <td>
                    <Expiry iso={c.expires.snapshot} signer="snapshot" />
                  </td>
                </tr>
                <tr>
                  <td className="mono">timestamp.json</td>
                  <td>{formatDateTime(c.expires.timestamp)}</td>
                </tr>
                {c.expires.channels.flatMap((ch) => [
                  <tr key={`${ch.channel}-c`}>
                    <td className="mono">channels.{ch.channel}.json</td>
                    <td>
                      <Expiry iso={ch.channelMetadata} signer="channel" />
                    </td>
                  </tr>,
                  <tr key={`${ch.channel}-a`}>
                    <td className="mono">channels.{ch.channel}.authors.json</td>
                    <td>
                      <Expiry iso={ch.authorsMetadata} signer="humanSigned" />
                    </td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </Page>
  )
}

export const OperatorCodes = () => {
  const codes = useOperatorData(() => call((api) => api.operator.inviteCodes()))
  const [note, setNote] = useState('')
  const create = useAction(async () => {
    await call((api) => api.operator.createInviteCode({ payload: { note: note.trim() } }))
    setNote('')
    await codes.reload()
  })
  return (
    <Page title="Invite codes" lead="One code per pilot company. A code works for one sign-up.">
      <Card title="New invite code">
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            void create.run()
          }}
        >
          <div className="field" style={{ flex: '1 1 16rem' }}>
            <label htmlFor="code-note" className="visually-hidden">
              Note
            </label>
            <input
              id="code-note"
              placeholder="Who is it for? e.g. Northwind Bank pilot"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" busy={create.busy}>
            Create code
          </Button>
        </form>
        <ErrorText error={create.error} />
      </Card>
      <Card>
        {codes.loading && !codes.data && <Loading />}
        <ul className="list">
          {codes.data?.map((code) => (
            <li key={code.code}>
              <div className="list-main">
                <strong className="mono">{code.code}</strong>
                <p>
                  {code.note || 'No note'} · created {formatDate(code.createdAt)}
                </p>
              </div>
              {code.usedAt ? (
                <Badge>Used by {code.usedBy}</Badge>
              ) : (
                <div className="row">
                  <Badge tone="success">Unused</Badge>
                  <CopyButton text={code.code} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  )
}

export const OperatorPilots = () => {
  const requests = useOperatorData(() => call((api) => api.operator.pilotRequests()))
  return (
    <Page title="Pilot requests" lead="Sent from the landing page form.">
      {requests.loading && !requests.data && <Loading />}
      {requests.data?.length === 0 && <Card quiet>No requests yet.</Card>}
      {requests.data?.map((request) => (
        <Card
          key={request.id}
          title={request.company}
          aside={<span className="muted small">{formatDateTime(request.createdAt)}</span>}
        >
          <p className="small" style={{ margin: 0 }}>
            {request.name} · <a href={`mailto:${request.email}`}>{request.email}</a>
          </p>
          {request.message && <p style={{ margin: '0.75rem 0 0' }}>{request.message}</p>}
        </Card>
      ))}
    </Page>
  )
}

export const OperatorLogin = () => {
  const [token, setToken] = useState('')
  const login = useAction(async () => {
    await call((api) => api.operator.login({ payload: { token: token.trim() } }))
    navigate('/operator')
  })
  return (
    <Shell>
      <div className="page wrap">
        <div className="auth">
          <p className="eyebrow">Operator</p>
          <h1>Operator sign-in</h1>
          <p className="lead">Use the token from the server’s operator secret file.</p>
          <Card>
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault()
                void login.run()
              }}
            >
              <Field label="Operator token" htmlFor="operator-token">
                <input
                  id="operator-token"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Field>
              <ErrorText error={login.error} />
              <div className="form-actions">
                <Button type="submit" busy={login.busy}>
                  Sign in
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </Shell>
  )
}
