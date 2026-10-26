import { type Check, passed } from './check.ts'

// `bun run --filter` pipes output, so colours cannot depend on a TTY.
const paint = (code: number) => (text: string) =>
  process.env.NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`

export const bold = paint(1)
export const dim = paint(2)
export const red = paint(31)
export const green = paint(32)

const OK = green('✓')
const FAILED = red('✗')

const elapsed = (since: number) => {
  const ms = performance.now() - since
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export const done = (text: string): void => console.log(`${OK} ${text}`)

/** Prints a line when a slow step starts and another when it ends. */
export const step = async <A>(text: string, task: () => Promise<A>): Promise<A> => {
  console.log(dim(`… ${text}`))
  const start = performance.now()
  try {
    const result = await task()
    done(`${text} ${dim(`(${elapsed(start)})`)}`)
    return result
  } catch (error) {
    console.log(`${FAILED} ${text}`)
    throw error
  }
}

/** Prints one line per check and tells whether all passed. */
export const printChecks = (origin: string, checks: ReadonlyArray<Check>): boolean => {
  console.log(`\n${bold(`Checking ${origin}`)}`)
  const width = Math.max(...checks.map((check) => check.path.length))
  for (const check of checks) {
    const path = check.path.padEnd(width)
    console.log(
      passed(check)
        ? `${OK} ${path}  ${dim(check.passed)}`
        : `${FAILED} ${path}  ${red(check.problems.join(' · '))}`,
    )
  }
  return checks.every(passed)
}

export const fail = (error: unknown): never => {
  console.log(`\n${red(`✗ ${error instanceof Error ? error.message : String(error)}`)}`)
  process.exit(1)
}
