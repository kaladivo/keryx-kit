import { type Check, createCheck } from './check.ts'
import { runMasterKey } from './masterKey.ts'
import { runOwnerLogin } from './ownerLogin.ts'
import { runPasskeyPrf } from './passkeyPrf.ts'
import {
  createTrezorClient,
  type TrezorClient,
  type TrezorMode,
  trezorModes,
} from './trezorClient.ts'

const params = new URLSearchParams(window.location.search)
const isTrezorMode = (value: string | null): value is TrezorMode =>
  trezorModes.some((mode) => mode === value)
const modeParam = params.get('trezor')
const mode: TrezorMode = isTrezorMode(modeParam) ? modeParam : 'auto'
const bridgePort = Number(params.get('bridgePort') ?? 21328)
const loginOrigin = params.get('loginOrigin') ?? window.location.origin

const element = <T extends HTMLElement>(selector: string, root: ParentNode = document): T => {
  const found = root.querySelector<T>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

const renderModeLinks = () => {
  element('#modes').replaceChildren(
    ...trezorModes.map((option) => {
      const link = document.createElement('a')
      const url = new URL(window.location.href)
      url.searchParams.set('trezor', option)
      link.href = url.toString()
      link.textContent = option
      if (option === mode) link.setAttribute('aria-current', 'true')
      return link
    }),
  )
}

const pairingForm = element<HTMLFormElement>('#pairing')
const askPairingCode = () =>
  new Promise<string>((resolve) => {
    pairingForm.hidden = false
    pairingForm.onsubmit = (event) => {
      event.preventDefault()
      pairingForm.hidden = true
      resolve(element<HTMLInputElement>('#pairing-code').value.trim())
    }
  })

let trezorClient: Promise<TrezorClient> | undefined
const trezor = (log: (line: string) => void) => {
  trezorClient ??= createTrezorClient({ mode, bridgePort, onEvent: log, askPairingCode })
  return trezorClient
}

const wireTest = (
  name: string,
  run: (check: Check, log: (line: string) => void) => Promise<void>,
) => {
  const section = element(`[data-test="${name}"]`)
  const output = element('pre', section)
  const log = (line: string) => {
    output.textContent += `${line}\n`
  }
  element('button', section).addEventListener('click', async () => {
    output.textContent = ''
    section.dataset.status = 'running'
    try {
      await run(createCheck(section, log), log)
      section.dataset.status = 'pass'
    } catch (error) {
      log(`error: ${error instanceof Error ? error.message : JSON.stringify(error)}`)
      section.dataset.status = 'fail'
    }
  })
}

renderModeLinks()
wireTest('owner-login', async (check, log) => runOwnerLogin(await trezor(log), check, loginOrigin))
wireTest('master-key', async (check, log) =>
  runMasterKey(await trezor(log), check, element<HTMLInputElement>('#company-id').value),
)
wireTest('passkey-prf', (check) => runPasskeyPrf(check))
