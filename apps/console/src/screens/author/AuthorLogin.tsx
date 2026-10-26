import { call } from '../../lib/api.ts'
import {
  prepareTasks,
  signTasks,
  submitTasks,
  unlockFromAssertion,
} from '../../lib/authorSigning.ts'
import { prfAssertion } from '../../lib/passkey.ts'
import { Link, navigate } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { PasskeyIcon } from '../../ui/icons.tsx'
import { Button, Card, ErrorText } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'
import { reportTaskOutcomes } from './AuthorArea.tsx'

/**
 * Discoverable passkey login. The same assertion also evaluates PRF, so pending tasks
 * (new channel, re-signs, renewals) are signed right after login with no second prompt.
 * The PRF output never goes into the login request.
 */
export const AuthorLogin = () => {
  const options = useAsync(() => call((api) => api.authMember.loginOptions()), [])
  const signIn = useAction(async () => {
    if (!options.data) return
    const { loginId, publicKey } = options.data
    const assertion = await prfAssertion({ options: publicKey })
    try {
      const me = await call((api) =>
        api.authMember.login({ payload: { loginId, credential: assertion.credential } }),
      )
      const [tasks, company] = await Promise.all([
        call((api) => api.ceremonies.tasks()),
        call((api) => api.company.get()),
      ])
      if (tasks.length > 0 && assertion.prf) {
        const targets = await prepareTasks(tasks, company)
        const signed = await unlockFromAssertion(me, assertion, (signer) =>
          signTasks(tasks, signer, targets),
        )
        reportTaskOutcomes(await submitTasks(signed))
      }
      navigate('/author')
    } catch (error) {
      await options.reload()
      throw error
    } finally {
      assertion.prf?.fill(0)
    }
  })
  return (
    <Shell>
      <div className="page wrap">
        <div className="auth">
          <p className="eyebrow">Author</p>
          <h1>Sign in with your passkey</h1>
          <p className="lead">
            Use the passkey you created from your invite link. Any signatures waiting for you are
            done in the same step.
          </p>
          <Card>
            <div className="hardware">
              <Button
                variant="hardware"
                busy={signIn.busy}
                disabled={!options.data}
                onClick={() => void signIn.run()}
              >
                <PasskeyIcon />
                Sign in with passkey
              </Button>
              <ErrorText error={signIn.error ?? options.error?.message} />
            </div>
          </Card>
          <p className="muted small" style={{ marginTop: '1.25rem' }}>
            No passkey yet? Ask the company owner for an invite link. Company owner?{' '}
            <Link to="/login">Sign in with Trezor</Link>.
          </p>
        </div>
      </div>
    </Shell>
  )
}
