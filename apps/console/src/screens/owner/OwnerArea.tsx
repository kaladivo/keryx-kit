import type { Company, Intent, OwnerAccount } from '@keryx-kit/api'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { ApiError, call, isUnauthorized } from '../../lib/api.ts'
import { navigate } from '../../lib/router.tsx'
import { useAsync } from '../../lib/useAsync.ts'
import { Button, Loading, Notice } from '../../ui/kit.tsx'
import { Shell } from '../../ui/Shell.tsx'

type CompanyData = typeof Company.Type

interface OwnerContextValue {
  readonly account: typeof OwnerAccount.Type
  readonly company: CompanyData
  readonly refresh: () => Promise<void>
}

const OwnerContext = createContext<OwnerContextValue | undefined>(undefined)

export const useOwner = (): OwnerContextValue => {
  const value = useContext(OwnerContext)
  if (!value) throw new Error('useOwner outside OwnerArea')
  return value
}

const nav = [
  { to: '/owner', label: 'Overview', exact: true },
  { to: '/owner/channels', label: 'Channels' },
  { to: '/owner/team', label: 'Team' },
  { to: '/owner/join', label: 'Join link' },
  { to: '/owner/activity', label: 'Activity' },
  { to: '/owner/settings', label: 'Company' },
]

const logout = async () => {
  await call((api) => api.authOwner.logout())
  navigate('/')
}

export const OwnerArea = ({ children }: { readonly children: ReactNode }) => {
  const session = useAsync(
    async () => ({
      account: await call((api) => api.authOwner.session()),
      company: await call((api) => api.company.get()),
    }),
    [],
  )
  useEffect(() => {
    if (isUnauthorized(session.error)) navigate('/login', { replace: true })
  }, [session.error])

  const company = session.data?.company
  return (
    <Shell
      home="/owner"
      nav={nav}
      account={
        company && (
          <>
            <span className="company-chip">
              {company.logo && <img src={company.logo} alt="" />}
              <span>{company.name}</span>
            </span>
            <Button small variant="quiet" onClick={() => void logout()}>
              Sign out
            </Button>
          </>
        )
      }
    >
      {session.data ? (
        <OwnerContext.Provider value={{ ...session.data, refresh: session.reload }}>
          {children}
        </OwnerContext.Provider>
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

/**
 * Asks the server to build a change, then opens the ceremony screen. When another
 * change is open, opens that one instead so the owner finishes or discards it.
 */
export const startCeremony = async (intent: Intent): Promise<void> => {
  try {
    const ceremony = await call((api) => api.ceremonies.start({ payload: { intent } }))
    navigate(`/owner/changes/${ceremony.id}`)
  } catch (error) {
    if (error instanceof ApiError && error.tag === 'CeremonyInProgress') {
      navigate(`/owner/changes/${String(error.detail.ceremonyId)}?blocked=1`)
      return
    }
    throw error
  }
}
