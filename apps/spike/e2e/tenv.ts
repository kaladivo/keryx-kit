/** Client for the trezor-user-env controller (https://github.com/trezor/trezor-user-env). */

export const controllerUrl = process.env.TENV_CONTROLLER ?? 'ws://127.0.0.1:19001'
export const bridgePort = Number(process.env.TENV_BRIDGE_PORT ?? 21330)
export const emulatorModel = process.env.TENV_MODEL ?? 'T3W1'
export const emulatorVersion = process.env.TENV_FIRMWARE ?? '2.13.0'

type ControllerResponse = { id: number; success: boolean; response?: unknown; error?: string }

let nextId = 1

export const tenv = (type: string, args: Record<string, unknown> = {}): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = nextId++
    const socket = new WebSocket(controllerUrl)
    socket.onerror = () => reject(new Error(`cannot reach trezor-user-env at ${controllerUrl}`))
    socket.onopen = () => socket.send(JSON.stringify({ id, type, ...args }))
    socket.onmessage = (event) => {
      const message: ControllerResponse = JSON.parse(String(event.data))
      if (message.id !== id) return
      socket.close()
      if (message.success) resolve(message.response)
      else reject(new Error(`${type}: ${message.error}`))
    }
  })

const waitForController = async () => {
  const deadline = Date.now() + 60_000
  while (
    !(await tenv('ping').then(
      () => true,
      () => false,
    ))
  ) {
    if (Date.now() > deadline) throw new Error(`trezor-user-env not reachable at ${controllerUrl}`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

export const startEmulator = async () => {
  await waitForController()
  await tenv('emulator-start', { model: emulatorModel, version: emulatorVersion, wipe: true })
  await tenv('emulator-setup', {
    mnemonic: 'all all all all all all all all all all all all',
    pin: '',
    passphrase_protection: false,
    label: 'keryx spike',
  })
  await tenv('bridge-start')
}

export type ScreenContent = { title: string; body: string }

const isScreenContent = (value: unknown): value is ScreenContent =>
  typeof value === 'object' &&
  value !== null &&
  'title' in value &&
  typeof value.title === 'string' &&
  'body' in value &&
  typeof value.body === 'string'

export const screenContent = async (): Promise<ScreenContent> => {
  const response = await tenv('emulator-get-screen-content')
  if (!isScreenContent(response)) throw new Error(`unexpected screen content ${response}`)
  return response
}

/** The six-digit THP pairing code from a Safe 7 "Enter this one-time security code" screen. */
export const pairingCode = (body: string): string | undefined =>
  body
    .match(/code.*?(\d{3}) ?(\d{3})/)
    ?.slice(1)
    .join('')
