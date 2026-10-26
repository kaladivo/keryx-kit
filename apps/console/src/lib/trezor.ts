import type { masterDerivation } from './masterKey.ts'

export interface TrezorLoginProof {
  readonly publicKey: string
  readonly signature: string
}

/** The two Connect calls the console makes. Each opens one Suite prompt. */
export interface TrezorClient {
  readonly requestLogin: (challenge: {
    readonly challengeHidden: string
    readonly challengeVisual: string
  }) => Promise<TrezorLoginProof>
  readonly cipherKeyValue: (
    bundle: ReadonlyArray<ReturnType<typeof masterDerivation>>,
  ) => Promise<ReadonlyArray<string>>
}

export class TrezorError extends Error {}

export const TREZOR_MANIFEST = {
  appName: 'keryx-kit',
  appUrl: 'https://keryx-kit.roguedave.codes',
  email: 'keryx-kit@roguedave.codes',
} as const

const friendly = (code: string | undefined, message: string): string => {
  if (code === 'Method_Interrupted' || /cancel/i.test(message))
    return 'The request was cancelled on the Trezor or in Suite. Nothing was signed.'
  if (/popup-blocked/i.test(message) || code === 'Method_WindowsOnly')
    return 'The browser blocked the Trezor Suite popup. Allow popups for this site and click again.'
  if (code === 'Transport_Missing' || /handshake|suite/i.test(message))
    return 'Trezor Suite did not answer. Open Trezor Suite (desktop), or use Chrome so Suite Web can open, then try again.'
  return `Trezor: ${message}`
}

type ConnectResponse<T> =
  | { success: true; payload: T }
  | { success: false; error: { message: string; code?: string } }

const unwrap = <T>(response: ConnectResponse<T>): T => {
  if (response.success) return response.payload
  throw new TrezorError(friendly(response.error.code, response.error.message))
}

const connectClient = async (): Promise<TrezorClient> => {
  const { default: connect } = await import('@trezor/connect-web')
  await connect.init({ manifest: TREZOR_MANIFEST, coreMode: 'auto' })
  return {
    requestLogin: async (challenge) => {
      const login = unwrap(await connect.requestLogin({ ...challenge }))
      return { publicKey: login.publicKey, signature: login.signature }
    },
    cipherKeyValue: async (bundle) =>
      unwrap(await connect.cipherKeyValue({ bundle: bundle.map((d) => ({ ...d })) })).map(
        (result) => result.value,
      ),
  }
}

let client: Promise<TrezorClient> | undefined

/**
 * Loads and initializes Trezor Connect once. Screens call it on mount so the click
 * handler only makes the Connect call itself (browsers block a Suite popup that does
 * not directly follow a click).
 */
export const trezorClient = (): Promise<TrezorClient> => {
  client ??= (
    import.meta.env.DEV && __TREZOR_STUB__
      ? import('../dev/trezorStub.ts').then((stub) => stub.stubTrezor())
      : connectClient()
  ).catch((error: unknown) => {
    client = undefined
    throw error
  })
  return client
}
