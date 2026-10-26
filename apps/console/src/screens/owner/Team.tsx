import type { Invite } from '@keryx-kit/api'
import { useState } from 'react'
import { call } from '../../lib/api.ts'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import {
  Button,
  Card,
  CopyButton,
  ErrorText,
  Field,
  Fingerprint,
  formatDate,
  Loading,
  Notice,
  Page,
} from '../../ui/kit.tsx'

export const Team = () => {
  const team = useAsync(() => call((api) => api.team.get()), [])
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<typeof Invite.Type>()
  const invite = useAction(async () => {
    setCreated(await call((api) => api.team.invite({ payload: { label: label.trim() } })))
    setLabel('')
    await team.reload()
  })

  return (
    <Page
      title="Team"
      lead="Authors write and sign posts with a passkey. Their signing key is created and encrypted on their own device; the server never sees it."
    >
      <div className="split">
        <div className="stack">
          <Card title="Registered authors">
            {team.loading && !team.data && <Loading />}
            {team.data?.members.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Nobody has registered yet. Send an invite link.
              </p>
            )}
            <ul className="list">
              {team.data?.members.map((member) => (
                <li key={member.id}>
                  <div className="list-main">
                    <strong>{member.name}</strong>
                    <p>
                      {member.keyLabel} · registered {formatDate(member.registeredAt)} ·{' '}
                      {member.channels.length > 0
                        ? `author of ${member.channels.join(', ')}`
                        : 'not on a channel yet'}
                    </p>
                  </div>
                  <Fingerprint keyid={member.keyid} />
                </li>
              ))}
            </ul>
            {team.data && team.data.members.length > 0 && (
              <p className="muted tiny" style={{ marginTop: '1rem' }}>
                Each author sees the same fingerprint under Home → Your key. Compare them once, in
                person or on a call, before you add someone to a channel.
              </p>
            )}
          </Card>
          {team.data && team.data.invites.length > 0 && (
            <Card title="Pending invites">
              <ul className="list">
                {team.data.invites.map((pending) => (
                  <li key={pending.id}>
                    <div className="list-main">
                      <strong>{pending.label || 'Unnamed invite'}</strong>
                      <p>
                        Sent {formatDate(pending.createdAt)} · expires{' '}
                        {formatDate(pending.expiresAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="stack">
          <Card title="Invite a team member">
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault()
                void invite.run()
              }}
            >
              <Field
                label="Who is it for?"
                htmlFor="invite-label"
                hint="Only you see this label. The link works once and expires after 7 days."
              >
                <input
                  id="invite-label"
                  value={label}
                  maxLength={100}
                  placeholder="Jana, marketing"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <ErrorText error={invite.error} />
              <div className="form-actions">
                <Button type="submit" busy={invite.busy}>
                  Create invite link
                </Button>
              </div>
            </form>
          </Card>
          {created && (
            <Notice tone="success" title={`Invite link for ${created.label || 'your team member'}`}>
              <p className="mono small">{created.url}</p>
              <p className="small">Send it over a channel you trust. It is shown only once.</p>
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <CopyButton text={created.url} label="Copy link" />
              </div>
            </Notice>
          )}
        </div>
      </div>
    </Page>
  )
}
