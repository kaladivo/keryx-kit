import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesEqual, bytesToHex, hexToBytes, utf8ToBytes, wipe } from './bytes.ts'
import type { Check } from './check.ts'
import type { TrezorClient } from './trezorClient.ts'

/** SLIP-0011 path (10016' is the SLIP-0011 purpose). */
export const masterKeyPath = "m/10016'/0"

/** The spec's fixed 32-byte `value`; the spike uses SHA-256 of a label so it is reproducible. */
export const masterKeyValue = bytesToHex(sha256(utf8ToBytes('keryx/master-key/v1')))

export const masterKeyLabel = (companyId: string) => `Keryx master key ${companyId}`

const derivation = (companyId: string) => ({
  path: masterKeyPath,
  key: masterKeyLabel(companyId),
  value: masterKeyValue,
  encrypt: true,
  askOnEncrypt: true,
  askOnDecrypt: true,
})

/**
 * One Connect call per user click: through Suite Web every call opens a popup, and the
 * browser blocks a popup that does not directly follow a click. Several derivations go in
 * one `bundle`.
 */
export const deriveMasterSeeds = async (
  trezor: TrezorClient,
  companyIds: readonly string[],
): Promise<Uint8Array[]> => {
  const response = await trezor.cipherKeyValue({ bundle: companyIds.map(derivation) })
  if (!response.success)
    throw new Error(`cipherKeyValue failed: ${response.error.code} ${response.error.message}`)
  return response.payload.map(({ value }) => hexToBytes(value))
}

export const runMasterKey = async (
  trezor: TrezorClient,
  check: Check,
  companyId: string,
): Promise<void> => {
  check.info(`path ${masterKeyPath}, key "${masterKeyLabel(companyId)}"`)
  check.info(`value ${masterKeyValue}`)
  const otherCompanyId = `${companyId}-other`
  const [first, second, other] = await deriveMasterSeeds(trezor, [
    companyId,
    companyId,
    otherCompanyId,
  ])
  if (!first || !second || !other) throw new Error('cipherKeyValue returned too few values')
  check.assert(first.length === 32, `output is 32 bytes (got ${first.length})`)
  check.assert(bytesEqual(first, second), 'two derivations give identical output')

  const publicKey = await ed.getPublicKeyAsync(first)
  check.info(`master Ed25519 public key ${bytesToHex(publicKey)}`)
  const message = utf8ToBytes(`keryx-kit spike ${companyId}`)
  const signature = await ed.signAsync(message, first)
  check.assert(await ed.verifyAsync(signature, message, publicKey), 'test signature verifies')

  const otherPublicKey = await ed.getPublicKeyAsync(other)
  check.info(`"${otherCompanyId}" public key ${bytesToHex(otherPublicKey)}`)
  check.assert(!bytesEqual(first, other), 'a different company_id gives a different key')

  check.result('masterPublicKey', bytesToHex(publicKey))
  wipe(first, second, other)
}
