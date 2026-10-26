/**
 * The newest `targets.json` version this browser has seen per company, so a ceremony
 * built on an older one (a rollback) is refused. Per browser only; storage may be off.
 */
const storageKey = (slug: string) => `keryx-seen-targets/${slug}`

export const seenTargetsVersion = (slug: string): number => {
  try {
    const version = Number(localStorage.getItem(storageKey(slug)))
    return Number.isInteger(version) && version > 0 ? version : 0
  } catch {
    return 0
  }
}

export const rememberTargetsVersion = (slug: string, version: number): void => {
  if (version <= seenTargetsVersion(slug)) return
  try {
    localStorage.setItem(storageKey(slug), String(version))
  } catch {
    // Without storage there is no earlier version to compare with.
  }
}
