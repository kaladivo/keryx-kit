import { call } from '../../lib/api.ts'
import { useAsync } from '../../lib/useAsync.ts'
import { Card, formatDateTime, Loading, Notice, Page } from '../../ui/kit.tsx'

const actorName = (actor: { kind: string; name?: string }) =>
  actor.kind === 'owner'
    ? 'Owner (Trezor)'
    : actor.kind === 'server'
      ? 'Server'
      : (actor.name ?? 'Author')

export const Activity = () => {
  const log = useAsync(() => call((api) => api.company.auditLog()), [])
  return (
    <Page
      title="Activity"
      lead="Every ceremony and publish, with who did it and which metadata versions it wrote."
    >
      {log.error && <Notice tone="danger">{log.error.message}</Notice>}
      <Card>
        {log.loading && !log.data && <Loading />}
        <div className="table-scroll">
          <table className="table">
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
                  <td>{entry.summary}</td>
                  <td className="mono tiny">
                    {Object.entries(entry.versions)
                      .map(([file, version]) => `${file} v${version}`)
                      .join(', ') || '—'}
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
