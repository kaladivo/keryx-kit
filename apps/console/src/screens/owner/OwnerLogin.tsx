import type { LoginChallenge } from '@keryx-kit/api'
import { useEffect, useState } from 'react'
import { call } from '../../lib/api.ts'
import { Link, navigate } from '../../lib/router.tsx'
import { trezorClient } from '../../lib/trezor.ts'
import { useAction } from '../../lib/useAsync.ts'
import { TrezorIcon } from '../../ui/icons.tsx'
import { Button, Card, ErrorText, Field } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

const SLUG_KEY = 'keryx-owner-slug'

const rememberedSlug = () => {
  try {
    return localStorage.getItem(SLUG_KEY) ?? ''
  } catch {
    return ''
  }
}

export const OwnerLogin = () => {
  const [slug, setSlug] = useState(rememberedSlug)
  const [challenge, setChallenge] = useState<typeof LoginChallenge.Type>()
  useEffect(() => {
    void trezorClient().catch(() => undefined)
  }, [])

  // The challenge is fetched first, so the Trezor click makes only the Connect call.
  const prepare = useAction(async () => {
    setChallenge(await call((api) => api.authOwner.challenge({ payload: { company: slug } })))
    try {
      localStorage.setItem(SLUG_KEY, slug)
    } catch {}
  })

  const signIn = useAction(async () => {
    if (!challenge) return
    const trezor = await trezorClient()
    const proof = await trezor.requestLogin(challenge)
    await call((api) =>
      api.authOwner.login({ payload: { challengeId: challenge.challengeId, ...proof } }),
    ).catch(async (error: unknown) => {
      setChallenge(undefined)
      throw error
    })
    navigate('/owner')
  })

  return (
    <Shell>
      <div className="page wrap">
        <div className="auth">
          <p className="eyebrow">Company owner</p>
          <h1>Sign in with Trezor</h1>
          <p className="lead">Your Trezor is your login. There is no password.</p>
          <Card>
            {!challenge ? (
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void prepare.run()
                }}
              >
                <Field
                  label="Company slug"
                  htmlFor="owner-slug"
                  hint="The short name you chose at sign-up."
                >
                  <input
                    id="owner-slug"
                    required
                    autoComplete="username"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.trim().toLowerCase())}
                  />
                </Field>
                <ErrorText error={prepare.error ?? signIn.error} />
                <div className="form-actions">
                  <Button type="submit" busy={prepare.busy}>
                    Continue
                  </Button>
                </div>
              </form>
            ) : (
              <div className="hardware">
                <p style={{ margin: 0 }}>
                  Confirm the login in Trezor Suite, then on the device. Check that it shows this
                  site:
                </p>
                <div className="device-screen">
                  <span>Sign HTTP</span>
                  {challenge.challengeVisual}
                  <br />
                  {location.host}
                </div>
                <Button variant="hardware" busy={signIn.busy} onClick={() => void signIn.run()}>
                  <TrezorIcon />
                  Sign in with Trezor
                </Button>
                <ErrorText error={signIn.error} />
                <button
                  type="button"
                  className="button-link small"
                  onClick={() => setChallenge(undefined)}
                >
                  Use another company
                </button>
              </div>
            )}
          </Card>
          <p className="muted small" style={{ marginTop: '1.25rem' }}>
            New here? <Link to="/signup">Sign up with an invite code</Link>. Writing posts?{' '}
            <Link to="/author/login">Author sign-in</Link>.
          </p>
        </div>
      </div>
    </Shell>
  )
}
