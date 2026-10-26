import TrezorConnect, {
  type ConnectSettings,
  UI_EVENT,
  UI_REQUEST,
  UI_REQUESTS,
  UI_RESPONSE,
} from '@trezor/connect'
import { BridgeTransport } from '@trezor/transport-common'
import { WebUsbTransport } from '@trezor/transport-web'
import { manifest, type TrezorClient, type TrezorSettings } from './trezorClient.ts'

const transportsFor = ({ mode, bridgePort }: TrezorSettings) => {
  const id = manifest.appName
  const transport =
    mode === 'bridge' ? new BridgeTransport({ id, port: bridgePort }) : new WebUsbTransport({ id })
  // connect-common declares an inlined copy of the transport classes, so the types do not unify.
  return [transport] as unknown as NonNullable<ConnectSettings['transports']>
}

export const createInPageClient = async (settings: TrezorSettings): Promise<TrezorClient> => {
  TrezorConnect.on(UI_EVENT, ({ type }) => settings.onEvent(`ui event: ${type}`))
  TrezorConnect.on(UI_REQUEST, async ({ type }) => {
    settings.onEvent(`ui request: ${type}`)
    if (type === UI_REQUESTS.REQUEST_THP_PAIRING_TAG) {
      const tag = await settings.askPairingCode()
      TrezorConnect.uiResponse({ type: UI_RESPONSE.RECEIVE_THP_PAIRING_TAG, payload: { tag } })
    }
  })
  await TrezorConnect.init({
    manifest,
    transports: transportsFor(settings),
    thp: { hostName: 'keryx-kit spike page', pairingMethods: ['CodeEntry'] },
  })
  return TrezorConnect
}
