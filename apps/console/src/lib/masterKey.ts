/** The master key derivation (mvp-spec §5.3). Every parameter here is frozen. */
import {
  currentRoot,
  ed25519Key,
  fromHex,
  keyidOf,
  publicKeyFromSeed,
  type RepoState,
} from '@keryx-kit/domain'
import type { TrezorClient } from './trezor.ts'

export const MASTER_KEY_PATH = "m/10016'/0"
/** SHA-256("keryx/master-key/v1"). */
export const MASTER_KEY_VALUE = 'c845593e08a1c9220cc24513f68fa275e370381e5704cb666af129b435ebf470'

export const masterKeyLabel = (slug: string): string => `Keryx master key ${slug}`

export const masterDerivation = (slug: string) =>
  ({
    path: MASTER_KEY_PATH,
    key: masterKeyLabel(slug),
    value: MASTER_KEY_VALUE,
    encrypt: true,
    askOnEncrypt: true,
    askOnDecrypt: true,
  }) as const

export class WrongWallet extends Error {
  constructor() {
    super(
      'This Trezor wallet derives a different master key than the one in your root.json. Switch Trezor Suite to the wallet you used at sign-up (for example, leave the passphrase wallet) and try again. Nothing was signed.',
    )
  }
}

/** One Connect call (one Suite popup), so it must start from the click handler. */
export const deriveMasterSeed = async (trezor: TrezorClient, slug: string): Promise<Uint8Array> => {
  const [value] = await trezor.cipherKeyValue([masterDerivation(slug)])
  if (value === undefined) throw new Error('The Trezor returned no key.')
  const seed = fromHex(value)
  if (seed.length !== 32) throw new Error(`The Trezor returned ${seed.length} bytes instead of 32.`)
  return seed
}

export const masterKeyidOf = (seed: Uint8Array): string =>
  keyidOf(ed25519Key(publicKeyFromSeed(seed)))

/** The keyid that signs `targets` (and `root`) in the current root of `state`. */
export const publishedMasterKeyid = (state: Pick<RepoState, 'roots'>): string | undefined => {
  const roles = currentRoot(state).signed.roles
  const [keyid] = roles.targets.keyids
  return keyid !== undefined && roles.root.keyids.includes(keyid) ? keyid : undefined
}

/** Refuses unless the Trezor-derived seed is the master key of the published root. */
export const requireMasterKey = (seed: Uint8Array, state: Pick<RepoState, 'roots'>): void => {
  if (masterKeyidOf(seed) !== publishedMasterKeyid(state)) throw new WrongWallet()
}
