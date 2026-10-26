import { useState } from 'react'
import { call } from '../../lib/api.ts'
import { Link } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { Button, Card, ErrorText, formatDate, Loading, Notice } from '../../ui/kit.tsx'

/** Published posts of a channel (C3), with unpublish (C5) and, for authors, edit (C4). */
export const ItemsList = ({
  channel,
  editPath,
}: {
  readonly channel: string
  readonly editPath?: (itemId: string) => string
}) => {
  const items = useAsync(() => call((api) => api.items.list({ params: { channel } })), [channel])
  const [confirming, setConfirming] = useState<string>()
  const unpublish = useAction(async (itemId: string) => {
    await call((api) => api.items.unpublish({ params: { channel, itemId } }))
    setConfirming(undefined)
    await items.reload()
  })
  return (
    <Card
      title="Published posts"
      aside={<span className="muted small">{items.data?.length ?? ''}</span>}
    >
      {items.error && <Notice tone="danger">{items.error.message}</Notice>}
      {items.loading && !items.data && <Loading />}
      {items.data?.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nothing published yet.
        </p>
      )}
      <ul className="list">
        {items.data?.map((item) => (
          <li key={item.id}>
            <div className="list-main">
              <strong>{item.title}</strong>
              <p>
                {formatDate(item.datePublished)}
                {item.dateModified && ` · edited ${formatDate(item.dateModified)}`} · signed by{' '}
                {item.signedBy.map((a) => a.name).join(', ') || 'a former author'}
              </p>
            </div>
            {confirming === item.id ? (
              <div className="row">
                <span className="small">Remove from every subscriber’s inbox?</span>
                <Button
                  small
                  variant="danger"
                  busy={unpublish.busy}
                  onClick={() => void unpublish.run(item.id)}
                >
                  Unpublish
                </Button>
                <Button small variant="quiet" onClick={() => setConfirming(undefined)}>
                  Keep
                </Button>
              </div>
            ) : (
              <div className="row">
                {editPath && (
                  <Link className="button button-small button-quiet" to={editPath(item.id)}>
                    Edit
                  </Link>
                )}
                <Button small variant="quiet" onClick={() => setConfirming(item.id)}>
                  Unpublish
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorText error={unpublish.error} />
    </Card>
  )
}
