import { spawn } from 'node:child_process'
import { build } from 'vite'
import { checkSiteUntilLive, ORIGIN } from './check.ts'
import { APP_DIR, installedFiles } from './kit.ts'
import { bold, fail, green, printChecks, red, step } from './ui.ts'

const VERCEL_PROJECT = 'keryx-demo-coffee'

const run = (command: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_DIR })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} failed:\n${output}`)),
    )
  })

/** Builds the site with whatever kit `public/` holds and deploys it to production. */
const buildAndDeploy = async () => {
  await step('Built the site', () => build({ root: APP_DIR, logLevel: 'error' }))
  await step('Deployed to production on Vercel', () =>
    run('vercel', [
      'deploy',
      'dist',
      '--prod',
      '--yes',
      '--project',
      VERCEL_PROJECT,
      '--local-config',
      'vercel.json',
    ]),
  )
}

/** Deploys, checks the live site against `public/`, and exits 0 only if every check passed. */
export const publish = async (success: string, failure: string): Promise<never> => {
  try {
    await buildAndDeploy()
    const passed = printChecks(ORIGIN, await checkSiteUntilLive(installedFiles()))
    console.log(`\n${passed ? bold(green(success)) : bold(red(failure))}`)
    process.exit(passed ? 0 : 1)
  } catch (error) {
    return fail(error)
  }
}
