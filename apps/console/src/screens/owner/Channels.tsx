import type { Channel } from '@keryx-kit/api'
import { CHANNEL_NAME } from '@keryx-kit/domain'
import { useState } from 'react'
import { call } from '../../lib/api.ts'
import { slugify } from '../../lib/item.ts'
import { Link } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  formatDate,
  Loading,
  Notice,
  Page,
} from '../../ui/kit.tsx'
import { startCeremony } from './OwnerArea.tsx'

type ChannelData = typeof Channel.Type

export const channelStatus = (channel: ChannelData) =>
  channel.status === 'live' ? (
    <Badge tone="success">Live</Badge>
  ) : (
    <Badge tone="warn">Waiting for an author</Badge>
  )

const NewChannel = ({ onCancel }: { readonly onCancel: () => void }) => {
  const team = useAsync(() => call((api) => api.team.get()), [])
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [authors, setAuthors] = useState<ReadonlyArray<string>>([])
  const create = useAction(async () => {
    const [first, ...rest] = authors
    if (!first) throw new Error('Pick at least one author.')
    if (slug === 'authors' || !CHANNEL_NAME.test(slug))
      throw new Error('The slug may only use a-z, 0-9, - and _ (and cannot be “authors”).')
    await startCeremony({
      _tag: 'CreateChannel',
      channel: slug,
      displayName: displayName.trim(),
      description: description.trim(),
      authors: [first, ...rest],
    })
  })
  const members = team.data?.members ?? []
  return (
    <Card title="New channel">
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          void create.run()
        }}
      >
        <Field
          label="Display name"
          htmlFor="channel-name"
          hint="Subscribers see this name in the app."
        >
          <input
            id="channel-name"
            required
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              if (!slugEdited) setSlug(slugify(e.target.value))
            }}
            placeholder="Offers"
          />
        </Field>
        <Field
          label="Slug"
          htmlFor="channel-slug"
          hint="Part of every post’s address and of join links. Lowercase letters, digits, - and _. It cannot change later."
        >
          <input
            id="channel-slug"
            required
            pattern="[a-z0-9_\-]+"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugEdited(true)
            }}
            placeholder="offers"
          />
        </Field>
        <Field label="Description" htmlFor="channel-description" optional>
          <textarea
            id="channel-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Sales and discount codes, at most once a week."
          />
        </Field>
        <fieldset className="choices">
          <legend>Authors</legend>
          {team.loading && !team.data && <Loading />}
          {team.data && members.length === 0 && (
            <Notice tone="warn">
              Nobody has registered yet. <Link to="/owner/team">Invite an author</Link> first.
            </Notice>
          )}
          {members.map((member) => (
            <label className="choice" key={member.id}>
              <input
                type="checkbox"
                checked={authors.includes(member.id)}
                onChange={(e) =>
                  setAuthors(
                    e.target.checked
                      ? [...authors, member.id]
                      : authors.filter((id) => id !== member.id),
                  )
                }
              />
              <span>
                {member.name}
                <small>{member.keyLabel}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="muted small" style={{ margin: 0 }}>
          The server creates the channel key. You sign the new delegation with your Trezor; the
          channel goes live once one of its authors opens the console and signs the author list.
        </p>
        <ErrorText error={create.error} />
        <div className="form-actions">
          <Button type="submit" busy={create.busy} disabled={members.length === 0}>
            Review and sign
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

export const Channels = () => {
  const channels = useAsync(() => call((api) => api.channels.list()), [])
  const [creating, setCreating] = useState(false)
  return (
    <Page
      title="Channels"
      lead="Each channel is a feed subscribers can follow. Authors listed on a channel can publish to it with their passkey."
      actions={!creating && <Button onClick={() => setCreating(true)}>New channel</Button>}
    >
      {creating && <NewChannel onCancel={() => setCreating(false)} />}
      {channels.error && <Notice tone="danger">{channels.error.message}</Notice>}
      {channels.data?.length === 0 && !creating && (
        <Card quiet>
          <p style={{ margin: 0 }}>No channels yet. Create one to start publishing.</p>
        </Card>
      )}
      <div className="grid grid-2">
        {channels.data?.map((channel) => (
          <Card
            key={channel.name}
            title={<Link to={`/owner/channels/${channel.name}`}>{channel.displayName}</Link>}
            aside={channelStatus(channel)}
          >
            <p className="muted small">{channel.description || 'No description'}</p>
            <dl className="kv small">
              <dt>Slug</dt>
              <dd className="mono">{channel.name}</dd>
              <dt>Authors</dt>
              <dd>{channel.authors.map((a) => a.name).join(', ') || '—'}</dd>
              <dt>Posts</dt>
              <dd>{channel.itemCount}</dd>
              {channel.authorsExpires && (
                <>
                  <dt>Author list valid</dt>
                  <dd>until {formatDate(channel.authorsExpires)}</dd>
                </>
              )}
            </dl>
          </Card>
        ))}
      </div>
      {channels.loading && !channels.data && <Loading />}
    </Page>
  )
}
