import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
window.addEventListener('popstate', notify)

export const navigate = (to: string, options: { replace?: boolean } = {}): void => {
  if (options.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.scrollTo(0, 0)
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const usePath = (): string =>
  useSyncExternalStore(subscribe, () => location.pathname + location.search)

/** `match('/channels/:name', '/channels/offers')` → `{ name: 'offers' }`. */
export const match = (pattern: string, path: string): Record<string, string> | undefined => {
  const want = pattern.split('/')
  const got = (path.split('?')[0] ?? '').replace(/\/$/, '').split('/')
  if (want.length !== got.length) return undefined
  const params: Record<string, string> = {}
  for (const [i, part] of want.entries()) {
    const value = got[i] ?? ''
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return undefined
  }
  return params
}

export const searchParam = (name: string): string | null =>
  new URLSearchParams(location.search).get(name)

export const Link = ({
  to,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { readonly to: string }) => (
  <a
    {...props}
    href={to}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(to)
    }}
  />
)
