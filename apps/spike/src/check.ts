export type Check = {
  info: (line: string) => void
  assert: (condition: boolean, claim: string) => void
  /** Publishes a value as `data-<name>` on the test section, for Playwright. */
  result: (name: string, value: string) => void
}

export class AssertionFailed extends Error {}

export const createCheck = (section: HTMLElement, log: (line: string) => void): Check => ({
  info: log,
  assert: (condition, claim) => {
    log(`${condition ? 'ok  ' : 'FAIL'} ${claim}`)
    if (!condition) throw new AssertionFailed(claim)
  },
  result: (name, value) => {
    section.dataset[name] = value
  },
})
