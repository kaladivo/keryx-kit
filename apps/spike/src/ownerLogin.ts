import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  bytesEqual,
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from './bytes.ts'
import type { Check } from './check.ts'
import type { TrezorClient } from './trezorClient.ts'

export type LoginChallenge = { challengeHidden: string; challengeVisual: string }

export type LoginProof = LoginChallenge & { publicKey: string; signature: string }

export const newLoginChallenge = (): LoginChallenge => ({
  challengeHidden: bytesToHex(randomBytes(32)),
  challengeVisual: new Date().toISOString().slice(0, 19).replace('T', ' '),
})

const bitcoinMessagePrefix = utf8ToBytes('\x18Bitcoin Signed Message:\n')

/** SLIP-0013 with the default (Bitcoin) sigtype: the device signs a Bitcoin signed message. */
const loginDigest = ({ challengeHidden, challengeVisual }: LoginChallenge): Uint8Array => {
  const challenge = concatBytes(
    sha256(hexToBytes(challengeHidden)),
    sha256(utf8ToBytes(challengeVisual)),
  )
  const message = concatBytes(bitcoinMessagePrefix, Uint8Array.of(challenge.length), challenge)
  return sha256(sha256(message))
}

/** The signature is 65 bytes: header (27 + 4 for compressed keys + recovery id), r, s. */
export const verifyLogin = (proof: LoginProof): boolean => {
  const signature = hexToBytes(proof.signature)
  const publicKey = hexToBytes(proof.publicKey)
  const header = signature[0]
  if (signature.length !== 65 || header === undefined) return false
  const digest = loginDigest(proof)
  const compact = signature.subarray(1)
  const recovered = secp256k1.recoverPublicKey(
    concatBytes(Uint8Array.of((header - 27) & 3), compact),
    digest,
    { prehash: false },
  )
  return (
    secp256k1.verify(compact, digest, publicKey, { prehash: false }) &&
    bytesEqual(recovered, publicKey)
  )
}

export const runOwnerLogin = async (
  trezor: TrezorClient,
  check: Check,
  origin: string,
): Promise<void> => {
  const challenge = newLoginChallenge()
  check.info(`origin ${origin}`)
  check.info(`challengeHidden ${challenge.challengeHidden}`)
  check.info(`challengeVisual "${challenge.challengeVisual}" (confirm it on the device)`)
  const response = await trezor.requestLogin({ ...challenge, origin })
  if (!response.success)
    throw new Error(`requestLogin failed: ${response.error.code} ${response.error.message}`)
  const proof = { ...challenge, ...response.payload }
  check.info(`identity public key ${proof.publicKey}`)
  check.info(`identity address ${proof.address}`)
  check.info(`signature ${proof.signature}`)
  check.assert(verifyLogin(proof), 'signature verifies against the identity public key')
  check.assert(
    !verifyLogin({ ...proof, challengeHidden: bytesToHex(randomBytes(32)) }),
    'signature does not verify for a different challenge',
  )
  check.result('identityPublicKey', proof.publicKey)
}
