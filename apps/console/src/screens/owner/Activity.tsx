import type { AuditEntry } from '@keryx-kit/api'
import { call } from '../../lib/api.ts'
import { useAsync } from '../../lib/useAsync.ts'
import { Badge, Card, formatDateTime, Loading, Notice, Page } from '../../ui/kit.tsx'

type Entry = typeof AuditEntry.Type

const actorName = (actor: Entry['actor']) =>
  actor.kind === 'owner'
    ? 'Owner (Trezor)'
    : actor.kind === 'server'
      ? 'Server'
      : (actor.name ?? 'Author')

const actionLabels: Record<Entry['action'], string> = {
  signup: 'Sign-up',
  'ceremony-started': 'Change started',
  'ceremony-staged': 'Signed, staged',
  'ceremony-applied': 'Change live',
  'ceremony-discarded': 'Change discarded',
  'authors-signed': 'Author list signed',
  'items-resigned': 'Posts re-signed',
  'item-published': 'Published',
  'item-edited': 'Edited',
  'item-unpublished': 'Unpublished',
  'invite-created': 'Invite',
  'member-registered': 'Registered',
}

const newestFirst = (entries: ReadonlyArray<Entry>) =>
  [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

export const Activity = () => {
  const log = useAsync(() => call((api) => api.company.auditLog()).then(newestFirst), [])
  return (
    <Page
      title="Activity"
      lead="Every ceremony and publish, with who did it and which metadata versions it wrote."
    >
      {log.error && <Notice tone="danger">{log.error.message}</Notice>}
      <Card>
        {log.loading && !log.data && <Loading />}
        <div className="table-scroll">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Versions</th>
              </tr>
            </thead>
            <tbody>
              {log.data?.map((entry) => (
                <tr key={`${entry.at}-${entry.action}-${entry.summary}`}>
                  <td className="nowrap">{formatDateTime(entry.at)}</td>
                  <td className="nowrap">{actorName(entry.actor)}</td>
                  <td>
                    <Badge>{actionLabels[entry.action]}</Badge> {entry.summary}
                  </td>
                  <td className="mono tiny">
                    {Object.entries(entry.versions)
                      .map(([file, version]) => `${file} v${version}`)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  )
}
