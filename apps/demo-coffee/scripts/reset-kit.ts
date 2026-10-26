/** `reset-kit`: removes the join kit and deploys the "coming soon" join page again. */
import { ORIGIN } from './check.ts'
import { resetKit } from './kit.ts'
import { publish } from './publish.ts'
import { bold, done } from './ui.ts'

console.log(`${bold(`Removing the Keryx join kit from ${ORIGIN}`)}\n`)
resetKit()
done('Removed the root files and restored the "coming soon" join page')
await publish(
  'Reset done: no kit, /join says "coming soon".',
  'The reset is not live. Fix the red lines and run reset-kit again.',
)
