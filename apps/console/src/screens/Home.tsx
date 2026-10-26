import { call } from '../lib/api.ts'
import { Link } from '../lib/router.tsx'
import { useAsync } from '../lib/useAsync.ts'
import { OperatorIcon, PasskeyIcon, TrezorIcon } from '../ui/icons.tsx'
import { Shell } from '../ui/Shell.tsx'

const optional = <A,>(promise: Promise<A>) => promise.catch(() => undefined)

export const Home = () => {
  const sessions = useAsync(
    async () => ({
      owner: await optional(call((api) => api.authOwner.session())),
      member: await optional(call((api) => api.authMember.me())),
    }),
    [],
  )
  const owner = sessions.data?.owner
  const member = sessions.data?.member
  return (
    <Shell>
      <div className="page wrap">
        <p className="eyebrow">Keryx publisher console</p>
        <h1>Signed announcements for your customers</h1>
        <p className="lead" style={{ maxWidth: '44rem' }}>
          Owners hold the company’s master key on a Trezor. Authors write and sign posts with a
          passkey. The server publishes, but it can never forge a post.
        </p>
        <div className="role-cards">
          <section className="card role-card">
            <TrezorIcon />
            <h2>Company owner</h2>
            <p className="muted small">
              Set up your company, manage channels and authors, and sign changes with your Trezor.
            </p>
            <div className="actions row">
              {owner ? (
                <Link className="button" to="/owner">
                  Continue as {owner.company.name}
                </Link>
              ) : (
                <>
                  <Link className="button" to="/login">
                    Sign in with Trezor
                  </Link>
                  <Link className="button button-quiet" to="/signup">
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </section>
          <section className="card role-card">
            <PasskeyIcon />
            <h2>Author</h2>
            <p className="muted small">
              Write posts and publish them with one passkey prompt. Got an invite? Open the link you
              received.
            </p>
            <div className="actions row">
              <Link className="button" to={member ? '/author' : '/author/login'}>
                {member ? `Continue as ${member.name}` : 'Sign in with passkey'}
              </Link>
            </div>
          </section>
          <section className="card role-card">
            <OperatorIcon />
            <h2>Operator</h2>
            <p className="muted small">
              Invite codes, pilot requests and the health of every company.
            </p>
            <div className="actions row">
              <Link className="button button-quiet" to="/operator">
                Operator dashboard
              </Link>
            </div>
          </section>
        </div>
        <p className="footer-note">
          The console runs the signing in your browser. Master and author private keys never leave
          this device.{' '}
          <a href="https://keryx-kit.roguedave.codes/subscribers">How Keryx protects subscribers</a>
        </p>
      </div>
    </Shell>
  )
}
