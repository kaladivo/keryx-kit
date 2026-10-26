import { ed25519Key, keyidOf } from '@keryx-kit/domain'

/**
 * The first 80 bits of a keyid in groups of four, e.g. `3f2a 91bc 0d4e 77aa 12f0`.
 * Ceremonies show it for every author key they add and authors see their own, so the
 * owner can compare the two out of band (mvp-spec §5.5).
 */
export const keyidFingerprint = (keyid: string): string =>
  (keyid.slice(0, 20).match(/.{4}/g) ?? []).join(' ')

export const keyidOfPublicKey = (publicKeyHex: string): string => keyidOf(ed25519Key(publicKeyHex))

export const fingerprintOf = (publicKeyHex: string): string =>
  keyidFingerprint(keyidOfPublicKey(publicKeyHex))
