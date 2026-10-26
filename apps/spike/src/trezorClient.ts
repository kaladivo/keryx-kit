import type TrezorConnect from '@trezor/connect-web'

export type TrezorClient = Pick<typeof TrezorConnect, 'requestLogin' | 'cipherKeyValue'>

/**
 * `suite-*` and `auto` go through `@trezor/connect-web`, the production path: Trezor Suite
 * (desktop over loopback, or Suite Web in a popup) hosts the Connect core and owns the device.
 * `bridge` and `webusb` run the Connect core inside this page (`@trezor/connect`). `bridge` is
 * the automated-test harness against trezor-user-env; `webusb` is a manual Chrome check.
 */
export type TrezorMode = 'auto' | 'suite-desktop' | 'suite-web' | 'bridge' | 'webusb'

export const trezorModes: readonly TrezorMode[] = [
  'auto',
  'suite-desktop',
  'suite-web',
  'bridge',
  'webusb',
]

export const manifest = {
  appName: 'keryx-kit spike',
  appUrl: 'https://keryx-kit.roguedave.codes',
  email: 'keryx-kit@roguedave.codes',
}

export type TrezorSettings = {
  mode: TrezorMode
  bridgePort: number
  onEvent: (line: string) => void
  askPairingCode: () => Promise<string>
}

export const createTrezorClient = async (settings: TrezorSettings): Promise<TrezorClient> => {
  if (settings.mode === 'bridge' || settings.mode === 'webusb') {
    const { createInPageClient } = await import('./trezorInPage.ts')
    return createInPageClient(settings)
  }
  const { default: connect } = await import('@trezor/connect-web')
  await connect.init({ manifest, coreMode: settings.mode })
  return connect
}
