import { useEffect, useState } from 'react'
import { call } from '../../lib/api.ts'
import { Link } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import {
  Button,
  Card,
  ErrorText,
  Field,
  Fingerprint,
  formatDate,
  Loading,
  Notice,
  Page,
} from '../../ui/kit.tsx'
import { ItemsList } from '../shared/ItemsList.tsx'
import { channelStatus } from './Channels.tsx'
import { startCeremony } from './OwnerArea.tsx'

export const ChannelDetail = ({ name }: { readonly name: string }) => {
  const data = useAsync(async () => {
    const [channels, team] = await Promise.all([
      call((api) => api.channels.list()),
      call((api) => api.team.get()),
    ])
    return { channel: channels.find((c) => c.name === name), team }
  }, [name])
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState('')
  useEffect(() => {
    setDisplayName(data.data?.channel?.displayName ?? '')
    setDescription(data.data?.channel?.description ?? '')
  }, [data.data])

  const edit = useAction(() =>
    startCeremony({ _tag: 'EditChannel', channel: name, displayName, description }),
  )
  const assign = useAction(() =>
    startCeremony({ _tag: 'AssignAuthor', channel: name, memberId: adding }),
  )
  const remove = useAction((memberId: string) =>
    startCeremony({ _tag: 'RemoveAuthor', channel: name, memberId }),
  )

  if (data.error)
    return (
      <Page title={name}>
        <Notice tone="danger">{data.error.message}</Notice>
      </Page>
    )
  if (!data.data)
    return (
      <Page title={name}>
        <Loading />
      </Page>
    )
  const { channel, team } = data.data
  if (!channel)
    return (
      <Page title={name} back={{ to: '/owner/channels', label: 'Channels' }}>
        <Notice tone="warn">There is no channel {name}.</Notice>
      </Page>
    )
  const live = channel.status === 'live'
  const authorIds = new Set(channel.authors.map((a) => a.memberId))
  const candidates = team.members.filter((m) => !authorIds.has(m.id))
  const keyOf = (memberId: string) => team.members.find((m) => m.id === memberId)?.keyid

  return (
    <Page
      back={{ to: '/owner/channels', label: 'Channels' }}
      title={channel.displayName}
      lead={channel.description || undefined}
      actions={
        <>
          {channelStatus(channel)}
          {live && (
            <Link className="button button-small button-quiet" to={`/owner/join?channel=${name}`}>
              Join link
            </Link>
          )}
        </>
      }
    >
      {!live && (
        <Notice tone="warn" title="Waiting for an author">
          The channel goes live after one of its authors opens the console. Their console signs the
          channel’s author list automatically.
        </Notice>
      )}
      <div className="split">
        <div className="stack">
          {live ? <ItemsList channel={name} /> : null}
          <Card title="Authors">
            <ul className="list">
              {channel.authors.map((author) => (
                <li key={author.memberId}>
                  <div className="list-main">
                    <strong>{author.name}</strong>
                    <p className="row" style={{ gap: '0.5rem' }}>
                      <span>{author.keyLabel}</span>
                      <Fingerprint keyid={keyOf(author.memberId) ?? author.keyid} />
                    </p>
                  </div>
                  {live && (
                    <Button
                      small
                      variant="danger"
                      disabled={channel.authors.length === 1}
                      title={
                        channel.authors.length === 1
                          ? 'A channel needs at least one author. Add another author first.'
                          : undefined
                      }
                      busy={remove.busy}
                      onClick={() => void remove.run(author.memberId)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {live && channel.authors.length === 1 && (
              <p className="muted tiny">The last author of a channel cannot be removed.</p>
            )}
            <ErrorText error={remove.error} />
            {live && (
              <form
                className="row"
                style={{ marginTop: '1rem' }}
                onSubmit={(event) => {
                  event.preventDefault()
                  void assign.run()
                }}
              >
                <div className="field" style={{ flex: '1 1 14rem' }}>
                  <label htmlFor="add-author" className="visually-hidden">
                    Add an author
                  </label>
                  <select
                    id="add-author"
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                  >
                    <option value="">
                      {candidates.length === 0 ? 'No other registered members' : 'Add an author…'}
                    </option>
                    {candidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.keyLabel})
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" small disabled={!adding} busy={assign.busy}>
                  Add with Trezor
                </Button>
              </form>
            )}
            <ErrorText error={assign.error} />
          </Card>
        </div>
        <div className="stack">
          <Card title="Display">
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault()
                void edit.run()
              }}
            >
              <Field label="Display name" htmlFor="edit-name">
                <input
                  id="edit-name"
                  required
                  value={displayName}
                  disabled={!live}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </Field>
              <Field label="Description" htmlFor="edit-description" optional>
                <textarea
                  id="edit-description"
                  value={description}
                  disabled={!live}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <ErrorText error={edit.error} />
              <div className="form-actions">
                <Button
                  type="submit"
                  small
                  busy={edit.busy}
                  disabled={
                    !live ||
                    (displayName === channel.displayName && description === channel.description)
                  }
                >
                  Save with Trezor
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Details">
            <dl className="kv small">
              <dt>Slug</dt>
              <dd className="mono">{channel.name}</dd>
              <dt>Posts</dt>
              <dd>{channel.itemCount}</dd>
              <dt>Author list valid</dt>
              <dd>
                {channel.authorsExpires ? `until ${formatDate(channel.authorsExpires)}` : '—'}
              </dd>
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  )
}
