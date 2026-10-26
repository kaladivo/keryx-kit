import { fromBase64url, type Item, itemSigningBytes, verifyEd25519 } from '@keryx-kit/domain'
import { DEMO_AUTHOR } from './demo-item.ts'

/** True when the item carries a valid signature by the demo author, as the app checks it. */
export const isSignedByDemoAuthor = (item: Item): boolean => {
  const entry = item.sig.find((signature) => signature.keyid === DEMO_AUTHOR.keyid)
  return (
    entry !== undefined &&
    verifyEd25519(fromBase64url(entry.sig), itemSigningBytes(item), DEMO_AUTHOR.publicKey)
  )
}
