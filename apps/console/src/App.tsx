import type { ReactNode } from 'react'
import { match, usePath } from './lib/router.tsx'
import { AuthorArea } from './screens/author/AuthorArea.tsx'
import { AuthorChannel, AuthorHome } from './screens/author/AuthorHome.tsx'
import { AuthorLogin } from './screens/author/AuthorLogin.tsx'
import { Editor } from './screens/author/Editor.tsx'
import { Invite } from './screens/author/Invite.tsx'
import { Home } from './screens/Home.tsx'
import {
  OperatorArea,
  OperatorCodes,
  OperatorDashboard,
  OperatorLogin,
  OperatorPilots,
} from './screens/operator/Operator.tsx'
import { Activity } from './screens/owner/Activity.tsx'
import { CeremonyScreen } from './screens/owner/CeremonyScreen.tsx'
import { ChannelDetail } from './screens/owner/ChannelDetail.tsx'
import { Channels } from './screens/owner/Channels.tsx'
import { Dashboard } from './screens/owner/Dashboard.tsx'
import { OwnerArea } from './screens/owner/OwnerArea.tsx'
import { OwnerLogin } from './screens/owner/OwnerLogin.tsx'
import { Settings } from './screens/owner/Settings.tsx'
import { Signup } from './screens/owner/Signup.tsx'
import { Team } from './screens/owner/Team.tsx'
import { JoinLink } from './screens/shared/JoinLink.tsx'
import { Page } from './ui/kit.tsx'
import { Shell } from './ui/Shell.tsx'

type Route = readonly [string, (params: Record<string, string>) => ReactNode]

const ownerRoutes: ReadonlyArray<Route> = [
  ['/owner', () => <Dashboard />],
  ['/owner/channels', () => <Channels />],
  ['/owner/channels/:name', ({ name = '' }) => <ChannelDetail name={name} />],
  ['/owner/changes/:id', ({ id = '' }) => <CeremonyScreen key={id} id={id} />],
  ['/owner/team', () => <Team />],
  ['/owner/join', () => <JoinLink />],
  ['/owner/activity', () => <Activity />],
  ['/owner/settings', () => <Settings />],
]

const authorRoutes: ReadonlyArray<Route> = [
  ['/author', () => <AuthorHome />],
  ['/author/write', () => <Editor key="new" />],
  [
    '/author/edit/:channel/:itemId',
    ({ channel = '', itemId = '' }) => (
      <Editor key={`${channel}/${itemId}`} channel={channel} itemId={itemId} />
    ),
  ],
  ['/author/channels/:name', ({ name = '' }) => <AuthorChannel name={name} />],
  ['/author/join', () => <JoinLink />],
]

const operatorRoutes: ReadonlyArray<Route> = [
  ['/operator', () => <OperatorDashboard />],
  ['/operator/codes', () => <OperatorCodes />],
  ['/operator/pilots', () => <OperatorPilots />],
]

const resolve = (routes: ReadonlyArray<Route>, path: string) => {
  for (const [pattern, render] of routes) {
    const params = match(pattern, path)
    if (params) return render(params)
  }
  return <Page title="Not found">This page does not exist.</Page>
}

export const App = () => {
  const path = usePath()
  const bare = path.split('?')[0]?.replace(/\/$/, '') || '/'
  if (bare === '/') return <Home />
  if (bare === '/signup') return <Signup />
  if (bare === '/login') return <OwnerLogin />
  if (bare === '/invite') return <Invite />
  if (bare === '/author/login') return <AuthorLogin />
  if (bare === '/operator/login') return <OperatorLogin />
  if (bare.startsWith('/owner')) return <OwnerArea>{resolve(ownerRoutes, bare)}</OwnerArea>
  if (bare.startsWith('/author')) return <AuthorArea>{resolve(authorRoutes, bare)}</AuthorArea>
  if (bare.startsWith('/operator'))
    return <OperatorArea>{resolve(operatorRoutes, bare)}</OperatorArea>
  return (
    <Shell>
      <Page title="Not found">This page does not exist.</Page>
    </Shell>
  )
}
