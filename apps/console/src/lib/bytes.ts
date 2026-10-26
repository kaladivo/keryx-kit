export const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(length))

/** Overwrites secrets once they are no longer needed (master seed, author key, PRF output). */
export const wipe = (...buffers: ReadonlyArray<Uint8Array | undefined>): void => {
  for (const buffer of buffers) buffer?.fill(0)
}

/** A copy on its own `ArrayBuffer`, which WebCrypto and WebAuthn require. */
export const ownBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes)
