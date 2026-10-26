import type { ReactNode } from 'react'
import { Link, usePath } from '../lib/router.tsx'
import { BrandMark } from './icons.tsx'

export interface NavItem {
  readonly to: string
  readonly label: string
  /** Also active for paths under `to` (default true, except for the area root). */
  readonly exact?: boolean
}

const isActive = (item: NavItem, path: string) => {
  const bare = path.split('?')[0] ?? ''
  return item.exact ? bare === item.to : bare === item.to || bare.startsWith(`${item.to}/`)
}

export const Shell = ({
  home = '/',
  nav = [],
  account,
  children,
}: {
  readonly home?: string
  readonly nav?: ReadonlyArray<NavItem>
  readonly account?: ReactNode
  readonly children: ReactNode
}) => {
  const path = usePath()
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="wrap app-header-inner">
          <Link className="brand" to={home} aria-label="Keryx console home">
            <BrandMark />
            <span>Keryx</span>
            <span className="brand-tag">Console</span>
          </Link>
          {nav.length > 0 && (
            <nav className="app-nav" aria-label="Main">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive(item, path) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          {account && <div className="app-account">{account}</div>}
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  )
}
