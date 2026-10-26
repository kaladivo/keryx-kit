/**
 * The company website an author confirmed once, and the master keyid its root chain
 * named then, per company in this browser. Like a subscriber pairing, later checks trust
 * this pin, not the origin the server reports.
 */
export interface CompanyPin {
  readonly joinOrigin: string
  readonly masterKeyid: string
}

const storageKey = (slug: string) => `keryx-company-pin/${slug}`

/** Keeps a pin for this session when the browser blocks storage. */
const sessionPins = new Map<string, CompanyPin>()

export const companyPin = (slug: string): CompanyPin | undefined =>
  storedPin(slug) ?? sessionPins.get(slug)

const storedPin = (slug: string): CompanyPin | undefined => {
  try {
    const pin = JSON.parse(localStorage.getItem(storageKey(slug)) ?? 'null') as unknown
    if (typeof pin !== 'object' || pin === null) return undefined
    const { joinOrigin, masterKeyid } = pin as Record<string, unknown>
    return typeof joinOrigin === 'string' && typeof masterKeyid === 'string'
      ? { joinOrigin, masterKeyid }
      : undefined
  } catch {
    return undefined
  }
}

export const pinCompany = (slug: string, pin: CompanyPin): void => {
  sessionPins.set(slug, pin)
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(pin))
  } catch {
    // Without storage the pin lasts for this session only.
  }
}
