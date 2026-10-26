import type { CreationOptions, Me } from '@keryx-kit/api'
import { useState } from 'react'
import { call } from '../../lib/api.ts'
import { generateAuthorKey, wrapAuthorKey, wrappedToWire } from '../../lib/authorKey.ts'
import { wipe } from '../../lib/bytes.ts'
import { fingerprintOf } from '../../lib/fingerprint.ts'
import {
  type CreatedPasskey,
  createPasskey,
  PrfUnsupported,
  prfAssertion,
  prfSupport,
  SUPPORTED_SETUPS,
} from '../../lib/passkey.ts'
import { Link } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { PasskeyIcon, ShieldIcon } from '../../ui/icons.tsx'
import { Button, Card, ErrorText, Field, formatDate, Loading, Notice } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

export const PrfRefusal = ({ passkeyCreated }: { readonly passkeyCreated?: boolean }) => (
  <Notice tone="danger" title="This browser cannot keep your signing key safe">
    <p>
      Keryx encrypts your author key with your passkey using the WebAuthn PRF extension. This
      browser or passkey provider does not support it, so registration stopped. Nothing was sent to
      the server.
    </p>
    {passkeyCreated && (
      <p>
        A passkey for this site was created but is not used. You can delete it in your password
        manager.
      </p>
    )}
    <p>Open your invite link again with one of these:</p>
    <ul className="small" style={{ margin: '0.25rem 0 0' }}>
      {SUPPORTED_SETUPS.map((setup) => (
        <li key={setup}>{setup}</li>
      ))}
    </ul>
  </Notice>
)

/** Generates the author key, wraps it with the PRF output and uploads only the wrapped key. */
const register = async (
  registrationId: string,
  created: CreatedPasskey,
  prf: Uint8Array,
): Promise<typeof Me.Type> => {
  const { seed, publicKey } = generateAuthorKey()
  try {
    const wrapped = await wrapAuthorKey(prf, seed, publicKey)
    return await call((api) =>
      api.authMember.register({
        payload: {
          registrationId,
          credential: created.credential,
          authorPublicKey: publicKey,
          wrappedKey: wrappedToWire(wrapped),
        },
      }),
    )
  } finally {
    wipe(seed, prf)
  }
}

export const Invite = () => {
  const token = location.hash.slice(1)
  const invite = useAsync(async () => {
    const [preview, support] = await Promise.all([
      call((api) => api.authMember.invite({ params: { token } })),
      prfSupport(),
    ])
    return { preview, support }
  }, [token])
  const [name, setName] = useState('')
  const [options, setOptions] = useState<{
    registrationId: string
    publicKey: typeof CreationOptions.Type
  }>()
  const [created, setCreated] = useState<CreatedPasskey>()
  const [unsupported, setUnsupported] = useState<'before' | 'after'>()
  const [me, setMe] = useState<typeof Me.Type>()

  const prepare = useAction(async () => {
    setOptions(
      await call((api) =>
        api.authMember.registrationOptions({ payload: { inviteToken: token, name: name.trim() } }),
      ),
    )
  })

  const unlockAndRegister = async (passkey: CreatedPasskey) => {
    if (!options) return
    const prf =
      passkey.prf ?? (await prfAssertion({ allowCredentials: [passkey.credentialId] })).prf
    if (prf === undefined) throw new PrfUnsupported()
    setMe(await register(options.registrationId, passkey, prf))
  }

  const createKey = useAction(async () => {
    if (!options) return
    let passkey: CreatedPasskey
    try {
      passkey = await createPasskey(options.publicKey)
    } catch (error) {
      if (error instanceof PrfUnsupported) {
        setUnsupported('after')
        return
      }
      throw error
    }
    // The PRF output is wiped after its one wrap, so a retry must ask the passkey again.
    setCreated({ ...passkey, prf: undefined })
    try {
      await unlockAndRegister(passkey)
    } catch (error) {
      if (error instanceof PrfUnsupported) setUnsupported('after')
      else throw error
    }
  })

  const retryUnlock = useAction(async () => {
    if (created) await unlockAndRegister(created)
  })

  return (
    <Shell>
      <div className="page wrap">
        <div className="auth">
          {invite.loading && !invite.data && <Loading />}
          {invite.error && (
            <Notice tone="danger" title="This invite cannot be used">
              {invite.error.message}
            </Notice>
          )}
          {invite.data && !me && (
            <>
              <h1>Join {invite.data.preview.companyName} as an author</h1>
              <p className="lead">
                You will publish signed announcements for {invite.data.preview.companyName}. Your
                signing key is created on this device and locked with a passkey. The server only
                stores it encrypted.
              </p>
              {invite.data.support === false || unsupported ? (
                <PrfRefusal passkeyCreated={unsupported === 'after'} />
              ) : (
                <Card>
                  {!options ? (
                    <form
                      className="form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void prepare.run()
                      }}
                    >
                      <Field
                        label="Your name"
                        htmlFor="author-name"
                        hint="Shown to the owner in the console. Subscribers see only a neutral label such as author-2."
                      >
                        <input
                          id="author-name"
                          required
                          maxLength={200}
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                      <ErrorText error={prepare.error} />
                      <div className="form-actions">
                        <Button type="submit" busy={prepare.busy}>
                          Continue
                        </Button>
                        <span className="muted small">
                          Link valid until {formatDate(invite.data.preview.expiresAt)}
                        </span>
                      </div>
                    </form>
                  ) : (
                    <div className="hardware">
                      <div className="hardware-art">
                        <PasskeyIcon />
                        <p style={{ margin: 0 }}>
                          Create a passkey for this site. Your browser or password manager asks you
                          to confirm with your fingerprint, face or PIN.
                        </p>
                      </div>
                      {created && !me ? (
                        <>
                          <Notice tone="info">
                            Passkey created. Confirm it once more to lock your new signing key.
                          </Notice>
                          <Button
                            variant="hardware"
                            busy={retryUnlock.busy}
                            onClick={() => void retryUnlock.run()}
                          >
                            <PasskeyIcon />
                            Lock my key with the passkey
                          </Button>
                          <ErrorText error={retryUnlock.error ?? createKey.error} />
                        </>
                      ) : (
                        <>
                          <Button
                            variant="hardware"
                            busy={createKey.busy}
                            onClick={() => void createKey.run()}
                          >
                            <PasskeyIcon />
                            Create passkey
                          </Button>
                          <ErrorText error={createKey.error} />
                        </>
                      )}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
          {me && (
            <div className="stack">
              <Notice tone="success" title="You are registered">
                <p>
                  The owner of {me.company.name} can now add you to a channel. Until then you cannot
                  publish.
                </p>
              </Notice>
              <Card>
                <div className="hardware-art">
                  <ShieldIcon />
                  <div>
                    <h2 style={{ marginBottom: '0.35rem' }}>Your key fingerprint</h2>
                    <code className="fingerprint fingerprint-large">
                      {fingerprintOf(me.authorPublicKey)}
                    </code>
                    <p className="muted small" style={{ margin: '0.6rem 0 0' }}>
                      Before the owner adds you to a channel with their Trezor, the console shows
                      them a fingerprint for your key. Read this one to them so they can check that
                      it matches. You can always find it on your home screen.
                    </p>
                  </div>
                </div>
              </Card>
              <div className="row">
                <Link className="button" to="/author">
                  Open the console
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
