import type { AuthorTask, Company, Me } from '@keryx-kit/api'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { call, isUnauthorized } from '../../lib/api.ts'
import {
  prepareTasks,
  signTasks,
  submitTasks,
  type TaskOutcome,
  withAuthorKey,
} from '../../lib/authorSigning.ts'
import { navigate } from '../../lib/router.tsx'
import { describeTask } from '../../lib/tasks.ts'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { PasskeyIcon } from '../../ui/icons.tsx'
import { Button, Loading, Notice } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

interface AuthorContextValue {
  readonly me: typeof Me.Type
  readonly company: typeof Company.Type
  readonly tasks: ReadonlyArray<AuthorTask>
  readonly refresh: () => Promise<void>
}

const AuthorContext = createContext<AuthorContextValue | undefined>(undefined)

export const useAuthor = (): AuthorContextValue => {
  const value = useContext(AuthorContext)
  if (!value) throw new Error('useAuthor outside AuthorArea')
  return value
}

/** Outcomes of tasks signed during login, shown once on the next screen. */
let pendingOutcomes: ReadonlyArray<TaskOutcome> = []
export const reportTaskOutcomes = (outcomes: ReadonlyArray<TaskOutcome>) => {
  pendingOutcomes = outcomes
}

const nav = [
  { to: '/author', label: 'Home', exact: true },
  { to: '/author/write', label: 'Write' },
  { to: '/author/join', label: 'Join link' },
]

const TaskOutcomes = ({
  outcomes,
  onDismiss,
}: {
  readonly outcomes: ReadonlyArray<TaskOutcome>
  readonly onDismiss: () => void
}) => {
  const failed = outcomes.filter((o) => o.error)
  const done = outcomes.filter((o) => !o.error)
  const dismiss = (
    <Button small variant="quiet" onClick={onDismiss}>
      Dismiss
    </Button>
  )
  return (
    <>
      {done.length > 0 && (
        <Notice
          actions={dismiss}
          tone="success"
          title={`Signed ${done.length} pending ${done.length === 1 ? 'task' : 'tasks'}`}
        >
          {done.map((o) => (
            <p key={o.task.id}>{o.description}</p>
          ))}
        </Notice>
      )}
      {failed.map((o) => (
        <Notice
          key={o.task.id}
          tone="danger"
          actions={dismiss}
          title={`Not signed: ${o.description}`}
        >
          {o.error}
        </Notice>
      ))}
    </>
  )
}

/** mvp-spec B3, B5, E3: pending signatures, all done with one passkey prompt. */
const TaskQueue = () => {
  const { me, company, tasks, refresh } = useAuthor()
  const [outcomes, setOutcomes] = useState<ReadonlyArray<TaskOutcome>>(() => {
    const shown = pendingOutcomes
    pendingOutcomes = []
    return shown
  })
  const sign = useAction(async () => {
    const targets = await prepareTasks(tasks, company)
    const signed = await withAuthorKey(me, (signer) => signTasks(tasks, signer, targets))
    setOutcomes(await submitTasks(signed))
    await refresh()
  })
  if (outcomes.length === 0 && tasks.length === 0) return null
  return (
    <div className="wrap task-strip">
      <TaskOutcomes outcomes={outcomes} onDismiss={() => setOutcomes([])} />
      {tasks.length > 0 && (
        <Notice
          tone="warn"
          title={`${tasks.length} ${tasks.length === 1 ? 'signature is' : 'signatures are'} waiting for you`}
          actions={
            <Button small busy={sign.busy} onClick={() => void sign.run()}>
              <PasskeyIcon />
              <span style={{ marginLeft: '0.4rem' }}>Sign now</span>
            </Button>
          }
        >
          {tasks.map((task) => (
            <p key={task.id}>{describeTask(task)}</p>
          ))}
          <p className="tiny muted">
            One passkey prompt signs all of them. They also run with your next publish.
          </p>
          {sign.error && <p className="field-error">{sign.error}</p>}
        </Notice>
      )}
    </div>
  )
}

const logout = async () => {
  await call((api) => api.authMember.logout())
  navigate('/')
}

export const AuthorArea = ({ children }: { readonly children: ReactNode }) => {
  const session = useAsync(async () => {
    const [me, company, tasks] = await Promise.all([
      call((api) => api.authMember.me()),
      call((api) => api.company.get()),
      call((api) => api.ceremonies.tasks()),
    ])
    return { me, company, tasks }
  }, [])
  useEffect(() => {
    if (isUnauthorized(session.error)) navigate('/author/login', { replace: true })
  }, [session.error])

  const data = session.data
  return (
    <Shell
      home="/author"
      nav={nav}
      account={
        data && (
          <>
            <span className="company-chip">
              {data.company.logo && <img src={data.company.logo} alt="" />}
              <span>{data.me.name}</span>
            </span>
            <Button small variant="quiet" onClick={() => void logout()}>
              Sign out
            </Button>
          </>
        )
      }
    >
      {data ? (
        <AuthorContext.Provider value={{ ...data, refresh: session.reload }}>
          <TaskQueue />
          {children}
        </AuthorContext.Provider>
      ) : session.error && !isUnauthorized(session.error) ? (
        <div className="page wrap">
          <Notice tone="danger">{session.error.message}</Notice>
        </div>
      ) : (
        <div className="page wrap">
          <Loading />
        </div>
      )}
    </Shell>
  )
}
