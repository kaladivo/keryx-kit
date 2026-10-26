/**
 * WebAuthn PRF output (mvp-spec §5.4). Browsers return an ArrayBuffer, but passkey
 * manager extensions do not always: 1Password returns a plain array of byte values, and
 * buffers created in another JS realm fail `instanceof`.
 */
const isByteArray = (value: unknown): value is ReadonlyArray<number> =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)

const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === '[object ArrayBuffer]'

/** A fresh copy of the bytes, or `undefined` when `value` is not byte data. */
export const prfBytes = (value: unknown): Uint8Array<ArrayBuffer> | undefined => {
  if (ArrayBuffer.isView(value))
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (isArrayBuffer(value)) return Uint8Array.from(new Uint8Array(value))
  if (isByteArray(value)) return Uint8Array.from(value)
  return undefined
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

/** `getClientExtensionResults().prf.results.first`, normalized. */
export const prfFirst = (extensionResults: unknown): Uint8Array<ArrayBuffer> | undefined =>
  prfBytes(field(field(field(extensionResults, 'prf'), 'results'), 'first'))

export const prfEnabled = (extensionResults: unknown): boolean =>
  field(field(extensionResults, 'prf'), 'enabled') === true
