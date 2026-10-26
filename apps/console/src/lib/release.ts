/** `public.release`, so anyone can compare the served bundle with the published hash (mvp-spec §5.9). */
import type { Release } from '@keryx-kit/api'
import { call } from './api.ts'

let release: Promise<typeof Release.Type | undefined> | undefined

export const loadRelease = (): Promise<typeof Release.Type | undefined> => {
  release ??= call((api) => api.public.release()).catch(() => undefined)
  return release
}
