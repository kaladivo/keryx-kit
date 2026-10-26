import { fromBase64url, type Item, itemSigningBytes, verifyEd25519 } from '@keryx-kit/domain'
import { DEMO_AUTHORS } from './demo-item.ts'

export interface AuthorCheck {
  name: string
  valid: boolean
}

export const checkAuthorSignatures = (item: Item): AuthorCheck[] => {
  const message = itemSigningBytes(item)
  return DEMO_AUTHORS.map((author) => {
    const entry = item.sig.find((signature) => signature.keyid === author.keyid)
    const valid =
      entry !== undefined && verifyEd25519(fromBase64url(entry.sig), message, author.publicKey)
    return { name: author.name, valid }
  })
}
