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

export const deriveMasterSeed = async (
  trezor: TrezorClient,
  companyId: string,
): Promise<Uint8Array> => {
  const response = await trezor.cipherKeyValue({
    path: masterKeyPath,
    key: masterKeyLabel(companyId),
    value: masterKeyValue,
    encrypt: true,
    askOnEncrypt: true,
    askOnDecrypt: true,
  })
  if (!response.success)
    throw new Error(`cipherKeyValue failed: ${response.error.code} ${response.error.message}`)
  return hexToBytes(response.payload.value)
}

export const runMasterKey = async (
  trezor: TrezorClient,
  check: Check,
  companyId: string,
): Promise<void> => {
  check.info(`path ${masterKeyPath}, key "${masterKeyLabel(companyId)}"`)
  check.info(`value ${masterKeyValue}`)
  const first = await deriveMasterSeed(trezor, companyId)
  const second = await deriveMasterSeed(trezor, companyId)
  check.assert(first.length === 32, `output is 32 bytes (got ${first.length})`)
  check.assert(bytesEqual(first, second), 'two derivations give identical output')

  const publicKey = await ed.getPublicKeyAsync(first)
  check.info(`master Ed25519 public key ${bytesToHex(publicKey)}`)
  const message = utf8ToBytes(`keryx-kit spike ${companyId}`)
  const signature = await ed.signAsync(message, first)
  check.assert(await ed.verifyAsync(signature, message, publicKey), 'test signature verifies')

  const otherCompanyId = `${companyId}-other`
  const other = await deriveMasterSeed(trezor, otherCompanyId)
  const otherPublicKey = await ed.getPublicKeyAsync(other)
  check.info(`"${otherCompanyId}" public key ${bytesToHex(otherPublicKey)}`)
  check.assert(!bytesEqual(first, other), 'a different company_id gives a different key')

  check.result('masterPublicKey', bytesToHex(publicKey))
  wipe(first, second, other)
}
