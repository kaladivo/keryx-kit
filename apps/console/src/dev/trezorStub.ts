/**
 * Dev-only stand-in for Trezor Connect (loaded only when `__TREZOR_STUB__`). Derivations
 * are deterministic so the mock API can seed repos with the same master key. Set
 * `localStorage['keryx-stub-wallet'] = 'hidden'` to act like a passphrase wallet.
 */
import { sha256Hex, utf8 } from '@keryx-kit/domain'
import type { TrezorClient } from '../lib/trezor.ts'

export const STUB_IDENTITY_KEY = `02${sha256Hex(utf8('keryx-kit stub trezor identity'))}`

export const stubMasterSeedHex = (label: string, wallet = 'standard'): string =>
  sha256Hex(utf8(`keryx-kit stub trezor/${wallet}/${label}`))

const wallet = (): string => {
  try {
    return localStorage.getItem('keryx-stub-wallet') ?? 'standard'
  } catch {
    return 'standard'
  }
}

const deviceDelay = () => new Promise((resolve) => setTimeout(resolve, 400))

export const stubTrezor = (): TrezorClient => ({
  requestLogin: async () => {
    await deviceDelay()
    return { publicKey: STUB_IDENTITY_KEY, signature: `1f${'ab'.repeat(64)}` }
  },
  cipherKeyValue: async (bundle) => {
    await deviceDelay()
    return bundle.map((derivation) => stubMasterSeedHex(derivation.key, wallet()))
  },
})
