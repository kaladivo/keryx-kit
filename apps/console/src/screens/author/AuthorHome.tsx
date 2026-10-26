import { call } from '../../lib/api.ts'
import { fingerprintOf } from '../../lib/fingerprint.ts'
import { Link, searchParam } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { Badge, Button, Card, formatDate, Loading, Notice, Page } from '../../ui/kit.tsx'
import { ItemsList } from '../shared/ItemsList.tsx'
import { useAuthor } from './AuthorArea.tsx'

const Drafts = () => {
  const drafts = useAsync(() => call((api) => api.items.drafts()), [])
  const remove = useAction(async (draftId: string) => {
    await call((api) => api.items.deleteDraft({ params: { draftId } }))
    await drafts.reload()
  })
  if (!drafts.data?.length) return null
  return (
    <Card title="Drafts">
      <ul className="list">
        {drafts.data.map((draft) => (
          <li key={draft.id}>
            <div className="list-main">
              <strong>{draft.content.title || 'Untitled'}</strong>
              <p>
                {draft.channel} · saved {formatDate(draft.updatedAt)}
              </p>
            </div>
            <div className="row">
              <Link
                className="button button-small"
                to={`/author/write?channel=${draft.channel}&draft=${draft.id}`}
              >
                Continue
              </Link>
              <Button
                small
                variant="quiet"
                busy={remove.busy}
                onClick={() => void remove.run(draft.id)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export const AuthorHome = () => {
  const { me, company } = useAuthor()
  const channels = useAsync(() => call((api) => api.channels.list()), [])
  const mine = (channels.data ?? []).filter((c) => c.authors.some((a) => a.memberId === me.id))
  return (
    <Page title={`Hello, ${me.name}`} lead={`Author for ${company.name}.`}>
      {channels.data && mine.length === 0 && (
        <Notice tone="info" title="You are registered">
          The owner has not added you to a channel yet. Once they do, you can write and publish
          here. Tell them your key fingerprint below.
        </Notice>
      )}
      <div className="split">
        <div className="stack">
          {channels.loading && !channels.data && <Loading />}
          {mine.map((channel) => (
            <Card
              key={channel.name}
              title={channel.displayName}
              aside={
                channel.status === 'live' ? (
                  <Badge tone="success">Live</Badge>
                ) : (
                  <Badge tone="warn">Waiting for an author</Badge>
                )
              }
            >
              <p className="muted small">{channel.description || channel.name}</p>
              <div className="row">
                <Link
                  className={`button button-small${channel.status === 'live' ? '' : ' button-quiet'}`}
                  to={`/author/write?channel=${channel.name}`}
                >
                  Write a post
                </Link>
                <Link
                  className="button button-small button-quiet"
                  to={`/author/channels/${channel.name}`}
                >
                  {channel.itemCount} published
                </Link>
              </div>
            </Card>
          ))}
          <Drafts />
        </div>
        <div className="stack">
          <Card title="Your key">
            <code className="fingerprint fingerprint-large">
              {fingerprintOf(me.authorPublicKey)}
            </code>
            <p className="muted small" style={{ margin: '0.75rem 0 0' }}>
              {me.keyLabel} · registered {formatDate(me.registeredAt)}. When the owner adds you to a
              channel, the console shows them this fingerprint. If they read you a different one,
              tell them not to sign.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  )
}

export const AuthorChannel = ({ name }: { readonly name: string }) => {
  const published = searchParam('published')
  return (
    <Page
      back={{ to: '/author', label: 'Home' }}
      title="Published posts"
      lead={<span className="mono">{name}</span>}
      actions={
        <Link className="button" to={`/author/write?channel=${name}`}>
          Write a post
        </Link>
      }
    >
      {published && (
        <Notice tone="success" title="Published">
          Signed and live. Subscribers get it at their next sync.
        </Notice>
      )}
      <ItemsList channel={name} editPath={(itemId) => `/author/edit/${name}/${itemId}`} />
    </Page>
  )
}
