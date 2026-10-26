import { call } from '../../lib/api.ts'
import { ownBytes } from '../../lib/bytes.ts'
import { expiryReminder } from '../../lib/expiry.ts'
import { Link } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { CheckIcon } from '../../ui/icons.tsx'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  formatDate,
  formatDateTime,
  Notice,
  Page,
} from '../../ui/kit.tsx'
import { startCeremony, useOwner } from './OwnerArea.tsx'

const domainBadge = {
  live: <Badge tone="success">Live</Badge>,
  mismatch: <Badge tone="danger">Mismatch</Badge>,
  'not-set-up': <Badge tone="warn">Not set up</Badge>,
} as const

export const TargetsExpiryBanner = () => {
  const { company } = useOwner()
  const renew = useAction(() => startCeremony({ _tag: 'RenewTargets' }))
  const reminder = expiryReminder(company.targetsExpires, new Date())
  if (!reminder) return null
  const when =
    reminder.daysLeft < 0
      ? 'has expired'
      : reminder.daysLeft === 0
        ? 'expires today'
        : `expires in ${reminder.daysLeft} ${reminder.daysLeft === 1 ? 'day' : 'days'}`
  return (
    <Notice
      tone={reminder.tier === 60 ? 'warn' : 'danger'}
      title={`Your signed company metadata (targets.json) ${when}`}
      actions={
        <Button small busy={renew.busy} onClick={() => void renew.run()}>
          Renew with Trezor
        </Button>
      }
    >
      <p>
        It is valid until {formatDate(company.targetsExpires)}. After that, subscriber apps stop
        accepting new posts until you renew it. Renewing takes one Trezor confirmation.
      </p>
      {renew.error && <p className="field-error">{renew.error}</p>}
    </Notice>
  )
}

export const DomainBanner = () => {
  const { company } = useOwner()
  if (company.domain.status !== 'mismatch') return null
  return (
    <Notice tone="danger" title={`${new URL(company.joinOrigin).host} no longer matches your repo`}>
      <p>
        {company.domain.reason ?? 'The files on your domain differ from the current root.json.'}
      </p>
      <p>
        New subscribers cannot pair until it is fixed. <Link to="/owner#domain">See the setup</Link>
        .
      </p>
    </Notice>
  )
}

const downloadKit = async (slug: string) => {
  const bytes = await call((api) => api.join.kit())
  const url = URL.createObjectURL(new Blob([ownBytes(bytes)], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `keryx-join-kit-${slug}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const JoinKitCard = () => {
  const { company } = useOwner()
  const download = useAction(() => downloadKit(company.slug))
  const host = new URL(company.joinOrigin).host
  return (
    <Card
      title="Join kit"
      aside={
        <Button small busy={download.busy} onClick={() => void download.run()}>
          Download zip
        </Button>
      }
    >
      <p className="muted small">
        Hand this to whoever runs {host}. It makes your domain the trust anchor that subscriber apps
        check when they pair.
      </p>
      <ol className="small">
        <li>
          Upload <code>.well-known/keryx/root.json</code> and every <code>N.root.json</code> to{' '}
          <code>https://{host}/.well-known/keryx/</code>.
        </li>
        <li>
          Upload <code>join/index.html</code> so it answers at <code>https://{host}/join</code>.
        </li>
        <li>
          Send <code>Access-Control-Allow-Origin: *</code> and{' '}
          <code>Content-Type: application/json</code> on <code>/.well-known/keryx/*</code>.
        </li>
        <li>
          Send <code>Referrer-Policy: no-referrer</code> on <code>/join</code>, and redact the{' '}
          <code>p</code> query parameter from access logs.
        </li>
      </ol>
      <p className="muted tiny">
        The README in the zip has ready-made snippets for nginx, Apache, Cloudflare and Netlify.
      </p>
      <ErrorText error={download.error} />
    </Card>
  )
}

const DomainCard = () => {
  const { company, refresh } = useOwner()
  const check = useAction(async () => {
    await call((api) => api.join.checkDomain())
    await refresh()
  })
  const { domain } = company
  return (
    <Card title="Domain" aside={domainBadge[domain.status]} id="domain">
      <dl className="kv small">
        <dt>Join origin</dt>
        <dd className="mono">{company.joinOrigin}</dd>
        <dt>Last checked</dt>
        <dd>{domain.checkedAt ? formatDateTime(domain.checkedAt) : 'Never'}</dd>
      </dl>
      {domain.status === 'live' && (
        <p className="small" style={{ marginTop: '0.75rem' }}>
          Your domain serves the current root and the join page. You can share your join link.
        </p>
      )}
      {domain.status === 'mismatch' && domain.reason && (
        <p className="small field-error">{domain.reason}</p>
      )}
      {domain.status === 'not-set-up' && (
        <p className="small muted" style={{ marginTop: '0.75rem' }}>
          Upload the join kit, then check again. The server also checks every day.
        </p>
      )}
      <div className="row" style={{ marginTop: '1rem' }}>
        <Button small variant="quiet" busy={check.busy} onClick={() => void check.run()}>
          Check now
        </Button>
      </div>
      <ErrorText error={check.error} />
    </Card>
  )
}

const OpenChanges = () => {
  const open = useAsync(() => call((api) => api.ceremonies.list()), [])
  if (!open.data?.length) return null
  return (
    <Card title="Open changes">
      <ul className="list">
        {open.data.map((change) => (
          <li key={change.id}>
            <div className="list-main">
              <strong>{change.summary}</strong>
              <p>
                {change.status === 'staged'
                  ? 'Signed. Waiting for an author signature.'
                  : 'Waiting for your Trezor signature.'}
              </p>
            </div>
            <Link className="button button-small" to={`/owner/changes/${change.id}`}>
              {change.status === 'staged' ? 'View' : 'Review and sign'}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const Checklist = () => {
  const { company } = useOwner()
  const channels = useAsync(() => call((api) => api.channels.list()), [])
  const team = useAsync(() => call((api) => api.team.get()), [])
  const steps = [
    {
      done: company.domain.status === 'live',
      text: 'Upload the join kit to your domain',
      to: '/owner#domain',
    },
    { done: (team.data?.members.length ?? 0) > 0, text: 'Invite an author', to: '/owner/team' },
    {
      done: (channels.data ?? []).some((c) => c.status === 'live'),
      text: 'Create a channel',
      to: '/owner/channels',
    },
    { done: false, text: 'Share your join link or QR code', to: '/owner/join' },
  ]
  const live = (channels.data ?? []).filter((c) => c.status === 'live')
  return (
    <>
      <div className="stats">
        <div className="card">
          <div className="stat">{live.length}</div>
          <p>live {live.length === 1 ? 'channel' : 'channels'}</p>
        </div>
        <div className="card">
          <div className="stat">{team.data?.members.length ?? '–'}</div>
          <p>registered authors</p>
        </div>
        <div className="card">
          <div className="stat">{live.reduce((sum, c) => sum + c.itemCount, 0)}</div>
          <p>published posts</p>
        </div>
      </div>
      <Card title="Getting started">
        <ul className="list">
          {steps.map((step) => (
            <li key={step.text} className="check-item" data-done={step.done || undefined}>
              <CheckIcon className="check-mark" />
              <Link to={step.to}>{step.text}</Link>
              {step.done && <span className="muted small">Done</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export const Dashboard = () => {
  const { company } = useOwner()
  return (
    <Page
      title={company.name}
      lead={
        <>
          Repo <span className="mono">{company.slug}</span> · join origin{' '}
          <span className="mono">{new URL(company.joinOrigin).host}</span>
        </>
      }
    >
      <TargetsExpiryBanner />
      <DomainBanner />
      <OpenChanges />
      <div className="split">
        <div className="stack">
          <Checklist />
        </div>
        <div className="stack">
          <DomainCard />
          <JoinKitCard />
        </div>
      </div>
    </Page>
  )
}
