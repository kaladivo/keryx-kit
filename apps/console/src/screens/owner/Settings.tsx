import { useState } from 'react'
import { LOGO_IMAGE } from '../../lib/image.ts'
import { useAction } from '../../lib/useAsync.ts'
import { ImagePicker } from '../../ui/ImagePicker.tsx'
import { Button, Card, ErrorText, formatDate, Notice, Page } from '../../ui/kit.tsx'
import { TargetsExpiryBanner } from './Dashboard.tsx'
import { startCeremony, useOwner } from './OwnerArea.tsx'

export const Settings = () => {
  const { company } = useOwner()
  const [logo, setLogo] = useState<string>()
  const change = useAction(async () => {
    if (!logo) throw new Error('Choose a new logo first.')
    await startCeremony({ _tag: 'ChangeLogo', logo })
  })
  const renew = useAction(() => startCeremony({ _tag: 'RenewTargets' }))
  return (
    <Page
      title="Company"
      lead="Your company identity as subscribers see it, signed by your master key."
    >
      <TargetsExpiryBanner />
      <div className="split">
        <div className="stack">
          <Card title="Logo">
            <div className="row" style={{ marginBottom: '1rem' }}>
              {company.logo && (
                <img className="logo logo-large" src={company.logo} alt="Current logo" />
              )}
              <div>
                <strong>{company.name}</strong>
                <p className="muted small" style={{ margin: 0 }}>
                  Changing the logo is a Trezor ceremony. Subscribers see a one-tap acknowledgement.
                </p>
              </div>
            </div>
            <ImagePicker
              label="New logo"
              value={logo}
              options={LOGO_IMAGE}
              onChange={setLogo}
              hint="Square images work best. It is resized to 256 px and embedded in targets.json."
            />
            <ErrorText error={change.error} />
            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <Button busy={change.busy} disabled={!logo} onClick={() => void change.run()}>
                Review and sign
              </Button>
            </div>
          </Card>
          <Card title="Renew signed metadata">
            <p className="small">
              <span className="mono">targets.json</span> is valid until{' '}
              <strong>{formatDate(company.targetsExpires)}</strong>. Renewing extends it by a year
              and changes nothing else.
            </p>
            <ErrorText error={renew.error} />
            <Button variant="quiet" busy={renew.busy} onClick={() => void renew.run()}>
              Renew with Trezor
            </Button>
          </Card>
        </div>
        <div className="stack">
          <Card title="Identity">
            <dl className="kv small">
              <dt>Name</dt>
              <dd>{company.name}</dd>
              <dt>Slug</dt>
              <dd className="mono">{company.slug}</dd>
              <dt>Join origin</dt>
              <dd className="mono">{company.joinOrigin}</dd>
              <dt>Repo</dt>
              <dd className="mono">{company.repoBase}</dd>
            </dl>
          </Card>
          <Notice tone="warn" title="Your recovery seed is the backup">
            <p>
              The master key is derived from your Trezor every time and stored nowhere. If you lose
              the device, a new Trezor restored from the same recovery seed gives the same key.
              Losing both means a new company identity, and every subscriber has to pair again.
            </p>
          </Notice>
        </div>
      </div>
    </Page>
  )
}
