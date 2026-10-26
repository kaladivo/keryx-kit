/** `deploy`: deploys the site with whatever kit `public/` holds, then checks it. */
import { ORIGIN } from './check.ts'
import { ensureJoinPage } from './kit.ts'
import { publish } from './publish.ts'
import { bold } from './ui.ts'

console.log(`${bold(`Deploying ${ORIGIN}`)}\n`)
ensureJoinPage()
await publish('Deployed and checked.', 'Deployed, but some checks failed.')
