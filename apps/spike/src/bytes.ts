export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(length))

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

export const wipe = (...buffers: Uint8Array[]): void => {
  for (const buffer of buffers) buffer.fill(0)
}
