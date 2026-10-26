import { JoinOrigin, type SignupStarted } from '@keryx-kit/api'
import {
  initRepo,
  publicKeyFromSeed,
  type RepoState,
  seedSigner,
  signatureFor,
} from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { useEffect, useState } from 'react'
import { call } from '../../lib/api.ts'
import { wipe } from '../../lib/bytes.ts'
import { runEffect } from '../../lib/effect.ts'
import { fingerprintOf } from '../../lib/fingerprint.ts'
import { LOGO_IMAGE } from '../../lib/image.ts'
import { slugify } from '../../lib/item.ts'
import { deriveMasterSeed, masterKeyLabel } from '../../lib/masterKey.ts'
import { Link } from '../../lib/router.tsx'
import { type TrezorLoginProof, trezorClient } from '../../lib/trezor.ts'
import { useAction } from '../../lib/useAsync.ts'
import { ImagePicker } from '../../ui/ImagePicker.tsx'
import { ShieldIcon, TrezorIcon } from '../../ui/icons.tsx'
import { Button, Card, ErrorText, Field, Notice } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

type Started = typeof SignupStarted.Type
type Step = 'details' | 'login' | 'master' | 'done'

const steps: ReadonlyArray<readonly [Step, string]> = [
  ['details', 'Company'],
  ['login', 'Trezor login'],
  ['master', 'Master key'],
  ['done', 'Done'],
]

const isJoinOrigin = Schema.is(JoinOrigin)

/** Short and readable: the Trezor shows it on every ceremony (mvp-spec §5.3). */
export const slugFromName = (name: string): string =>
  slugify(name).replace(/_/g, '-').slice(0, 24).replace(/-+$/, '')

const StepsBar = ({ current }: { readonly current: Step }) => {
  const index = steps.findIndex(([step]) => step === current)
  return (
    <ol className="steps-bar" style={{ ['--count' as string]: steps.length }}>
      {steps.map(([step, label], i) => (
        <li
          key={step}
          data-state={i < index ? 'done' : i === index ? 'current' : undefined}
          aria-current={i === index ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}

const Details = ({
  onStarted,
}: {
  readonly onStarted: (started: Started, slug: string) => void
}) => {
  const [inviteCode, setInviteCode] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [host, setHost] = useState('')
  const [email, setEmail] = useState('')
  const [logo, setLogo] = useState<string>()
  const origin = `https://${host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')}`
  const originOk = host === '' || isJoinOrigin(origin)
  const submit = useAction(async () => {
    if (!isJoinOrigin(origin))
      throw new Error('Enter the join origin as a hostname, like acme.com.')
    const started = await call((api) =>
      api.authOwner.signup({
        payload: {
          inviteCode: inviteCode.trim(),
          slug,
          companyName: companyName.trim(),
          joinOrigin: origin,
          contactEmail: email.trim(),
          ...(logo ? { logo } : {}),
        },
      }),
    )
    onStarted(started, slug)
  })
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit.run()
      }}
    >
      <Field
        label="Invite code"
        htmlFor="invite-code"
        hint="From the Keryx team. Pilot companies only."
      >
        <input
          id="invite-code"
          required
          autoComplete="off"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
        />
      </Field>
      <Field
        label="Company name"
        htmlFor="company-name"
        hint="Subscribers see it next to every post."
      >
        <input
          id="company-name"
          required
          maxLength={200}
          value={companyName}
          onChange={(e) => {
            setCompanyName(e.target.value)
            if (!slugEdited) setSlug(slugFromName(e.target.value))
          }}
        />
      </Field>
      <Field
        label="Company slug"
        htmlFor="company-slug"
        hint={
          <>
            Your Trezor shows it every time you sign:{' '}
            <span className="mono">{masterKeyLabel(slug || 'your-slug')}</span>. It is part of your
            master key, so it <strong>can never change</strong>. Up to 24 characters: a-z, 0-9 and
            hyphens.
          </>
        }
      >
        <input
          id="company-slug"
          required
          pattern="[a-z0-9](?:[a-z0-9\-]{0,22}[a-z0-9])?"
          maxLength={24}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase())
            setSlugEdited(true)
          }}
        />
      </Field>
      <Field
        label="Join origin"
        htmlFor="join-origin"
        error={
          originOk ? undefined : 'Use a plain hostname such as acme.com, without a path or port.'
        }
        hint="Must be HTTPS on a hostname your company controls. You will upload two files there; subscribers check this domain when they pair."
      >
        <div className="field-inline">
          <span className="prefix">https://</span>
          <input
            id="join-origin"
            required
            inputMode="url"
            autoComplete="off"
            placeholder="acme.com"
            value={host}
            aria-invalid={!originOk || undefined}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
      </Field>
      <Field
        label="Contact email"
        htmlFor="contact-email"
        hint="For the Keryx operator only. It is never used to sign in."
      >
        <input
          id="contact-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <ImagePicker
        label="Logo"
        value={logo}
        options={LOGO_IMAGE}
        onChange={setLogo}
        hint="Resized to 256 px and embedded in your signed metadata. You can change it later."
      />
      <ErrorText error={submit.error} />
      <div className="form-actions">
        <Button type="submit" busy={submit.busy}>
          Continue
        </Button>
        <span className="muted small">
          Already signed up? <Link to="/login">Sign in with Trezor</Link>
        </span>
      </div>
    </form>
  )
}

const signInitialRepo = (started: Started, seed: Uint8Array) =>
  Effect.gen(function* () {
    const masterPublicKey = publicKeyFromSeed(seed)
    const state: RepoState = yield* initRepo(
      { ...started.init.params, masterKey: masterPublicKey },
      { now: new Date(started.init.now) },
    )
    const signer = seedSigner(seed)
    const root = state.roots[0]
    if (!root) return yield* Effect.fail(new Error('No root.json was built.'))
    return {
      masterPublicKey,
      signatures: {
        root: yield* signatureFor(root, signer),
        targets: yield* signatureFor(state.targets, signer),
      },
    }
  })

export const Signup = () => {
  const [step, setStep] = useState<Step>('details')
  const [started, setStarted] = useState<Started>()
  const [slug, setSlug] = useState('')
  const [login, setLogin] = useState<TrezorLoginProof>()
  const [masterFingerprint, setMasterFingerprint] = useState<string>()
  useEffect(() => {
    if (step === 'login') void trezorClient().catch(() => undefined)
  }, [step])

  const trezorLogin = useAction(async () => {
    if (!started) return
    const trezor = await trezorClient()
    setLogin(await trezor.requestLogin(started.challenge))
    setStep('master')
  })

  const createMaster = useAction(async () => {
    if (!started || !login) return
    const trezor = await trezorClient()
    let seed: Uint8Array | undefined
    try {
      seed = await deriveMasterSeed(trezor, slug)
      const signed = await runEffect(signInitialRepo(started, seed))
      await call((api) =>
        api.authOwner.completeSignup({
          params: { signupId: started.signupId },
          payload: { login, ...signed },
        }),
      )
      setMasterFingerprint(fingerprintOf(signed.masterPublicKey))
      setStep('done')
    } finally {
      wipe(seed)
    }
  })

  const host = location.host
  return (
    <Shell>
      <div className="page wrap">
        <div className="auth auth-wide">
          <p className="eyebrow">Sign up</p>
          <h1>Create your company on Keryx</h1>
          <p className="lead">
            You need an invite code and a Trezor. The Trezor holds your master key: nobody else,
            including this service, can change who may publish for your company.
          </p>
          <StepsBar current={step} />
          {step === 'details' && (
            <Card>
              <Details
                onStarted={(s, chosenSlug) => {
                  setStarted(s)
                  setSlug(chosenSlug)
                  setStep('login')
                }}
              />
            </Card>
          )}
          {step === 'login' && started && (
            <Card title="Connect your Trezor">
              <div className="hardware">
                <p style={{ margin: 0 }}>
                  This Trezor becomes your owner login. Open Trezor Suite on this computer, or use
                  Chrome or Edge, which open Suite in a popup. The first time, Suite asks you to
                  pair the device.
                </p>
                <div className="device-screen">
                  <span>Sign HTTP</span>
                  {started.challenge.challengeVisual}
                  <br />
                  {host}
                </div>
                <Button
                  variant="hardware"
                  busy={trezorLogin.busy}
                  onClick={() => void trezorLogin.run()}
                >
                  <TrezorIcon />
                  Sign in with Trezor
                </Button>
                <ErrorText error={trezorLogin.error} />
              </div>
            </Card>
          )}
          {step === 'master' && started && (
            <Card title="Create your master key">
              <div className="hardware">
                <p style={{ margin: 0 }}>
                  The Trezor derives your master key. The browser uses it to sign your first
                  metadata, then erases it. It is never stored anywhere.
                </p>
                <div className="device-screen">
                  <span>Encrypt value</span>
                  {masterKeyLabel(slug)}
                </div>
                <ul className="small" style={{ margin: 0 }}>
                  <li>
                    <strong>root.json v1</strong>: your master key signs root and targets; the
                    server’s ops key signs snapshot and timestamp.
                  </li>
                  <li>
                    <strong>targets.json v1</strong>: company name {started.init.params.companyName}
                    {started.init.params.logo ? ', your logo' : ''}, no channels yet.
                  </li>
                </ul>
                <Notice tone="info">
                  Use the Suite wallet you will always use for this company. A passphrase wallet
                  gives a different master key.
                </Notice>
                <Button
                  variant="hardware"
                  busy={createMaster.busy}
                  onClick={() => void createMaster.run()}
                >
                  <TrezorIcon />
                  Create master key and sign
                </Button>
                <ErrorText error={createMaster.error} />
              </div>
            </Card>
          )}
          {step === 'done' && (
            <div className="stack">
              <Notice tone="success" title="Your company is set up">
                <p>
                  root.json and targets.json v1 are signed and published. Master key fingerprint{' '}
                  <code className="fingerprint">{masterFingerprint}</code>
                </p>
              </Notice>
              <Card>
                <div className="hardware-art">
                  <ShieldIcon />
                  <div>
                    <h2 style={{ marginBottom: '0.25rem' }}>Your recovery seed is the backup</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      Keep the Trezor recovery seed safe. A Trezor restored from it gives the same
                      master key. If you lose both the device and the seed, you need a new company
                      identity and every subscriber has to pair again.
                    </p>
                  </div>
                </div>
              </Card>
              <div className="row">
                <Link className="button" to="/owner">
                  Go to your console
                </Link>
                <span className="muted small">Next: download the join kit for your web admin.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
