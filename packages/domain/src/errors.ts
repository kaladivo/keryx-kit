import { Data } from 'effect'

export type RefusalCode =
  | 'invalid-channel-name'
  | 'reserved-channel-name'
  | 'channel-exists'
  | 'unknown-channel'
  | 'not-authored'
  | 'no-authors'
  | 'key-overlap'
  | 'author-listed'
  | 'author-not-listed'
  | 'last-author'
  | 'invalid-company'
  | 'invalid-logo'
  | 'invalid-item'
  | 'item-too-large'
  | 'unauthorized-item'
  | 'item-not-published'
  | 'unauthorized-signer'
  | 'bad-signature'
  | 'invalid-metadata'
  | 'invalid-repo'
  | 'invalid-join'

/** An operation refused to build what was asked (the reference tool's fail-safes). */
export class Refused extends Data.TaggedError('Refused')<{
  readonly code: RefusalCode
  readonly message: string
}> {}

export const refuse = (code: RefusalCode, message: string): Refused =>
  new Refused({ code, message })

/** A signer could not produce a signature (device cancelled, passkey failed, ...). */
export class SigningFailed extends Data.TaggedError('SigningFailed')<{
  readonly keyid: string
  readonly cause: unknown
}> {}
