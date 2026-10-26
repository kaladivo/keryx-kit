import { Effect, Schema } from 'effect'
import { fromBase64url, fromUtf8, toBase64url, utf8 } from './bytes.ts'
import { type Signer, verifyEd25519 } from './crypto.ts'
import { type Refused, refuse, type SigningFailed } from './errors.ts'
import { canonicalJson, goJson } from './json.ts'
import type { Authority } from './metadata.ts'
import { Item, type ItemDraft, type ItemSignature, strictDecoding } from './schema.ts'
import { isLinkedHttpsUrl } from './url.ts'

/** spec/feeds.md §1.1 RECOMMENDED limit; the subscriber app enforces the same. */
export const ITEM_MAX_BYTES = 1024 * 1024

export const itemPath = (channel: string, id: string): string => `channels/${channel}/${id}.json`

/** OLPC canonical JSON of the item without `sig` (spec/feeds.md §1.2). */
export const itemSigningBytes = (item: ItemDraft): Uint8Array => {
  const { sig: _sig, ...unsigned } = item
  return utf8(canonicalJson(unsigned))
}

export const itemSignatureFor = (
  item: ItemDraft,
  signer: Signer,
): Effect.Effect<ItemSignature, SigningFailed> =>
  Effect.map(signer.sign(itemSigningBytes(item)), (sig) => ({
    keyid: signer.keyid,
    sig: toBase64url(sig),
  }))

/** Adds (or replaces) the signer's entry in `sig`. */
export const withItemSignature = (item: ItemDraft, signature: ItemSignature): Item => ({
  ...item,
  sig: [...(item.sig ?? []).filter((s) => s.keyid !== signature.keyid), signature],
})

export const signItem = (item: ItemDraft, signer: Signer): Effect.Effect<Item, SigningFailed> =>
  Effect.map(itemSignatureFor(item, signer), (signature) => withItemSignature(item, signature))

/** File bytes, identical to the Go SDK's `feed.Encode`. */
export const encodeItem = (item: Item): Uint8Array =>
  utf8(`${goJson(item, { indent: '  ', escapeHtml: false })}\n`)

export const decodeItemJson = (input: unknown): Effect.Effect<Item, Refused> =>
  Schema.decodeUnknownEffect(Item)(input, strictDecoding).pipe(
    Effect.mapError((error) => refuse('invalid-item', error.message)),
  )

export const decodeItem = (bytes: Uint8Array): Effect.Effect<Item, Refused> =>
  Effect.try({
    try: () => JSON.parse(fromUtf8(bytes)) as unknown,
    catch: () => refuse('invalid-item', 'item is not JSON'),
  }).pipe(Effect.flatMap(decodeItemJson))

const linkedRule = (url: string): string | undefined =>
  isLinkedHttpsUrl(url) ? undefined : 'must be an absolute HTTPS URL'

/** Content rules the schema cannot express (Go `feed.ValidateItemOptions`). */
export const itemContentProblem = (item: ItemDraft): string | undefined => {
  if (item.image !== undefined) {
    if (item.image.startsWith('data:')) {
      if (!item.image.includes(';base64,')) return 'image data URL must be base64'
    } else {
      const problem = linkedRule(item.image)
      if (problem) return `image ${problem}`
      if (item.image_sha256 === undefined) return 'linked image requires image_sha256'
    }
  }
  for (const [i, attachment] of (item.attachments ?? []).entries()) {
    const problem = linkedRule(attachment.url)
    if (problem) return `attachment ${i} url ${problem}`
  }
  return undefined
}

/**
 * spec/feeds.md §1.2 for an authored channel: at least `threshold` distinct author
 * keys verify; an entry by a known key that does not verify rejects the item.
 * `known` lists every key whose entries must verify (authors and channel role).
 */
export const verifyItemSignatures = (
  item: Item,
  authors: Authority,
  known: Authority = authors,
): Effect.Effect<ReadonlyArray<string>, Refused> => {
  const message = itemSigningBytes(item)
  const valid = new Set<string>()
  for (const entry of item.sig) {
    const key = known.keys[entry.keyid]
    if (!known.keyids.includes(entry.keyid) || key === undefined) continue
    if (!verifyEd25519(fromBase64url(entry.sig), message, key.keyval.public)) {
      return Effect.fail(
        refuse('bad-signature', `item ${item.id}: signature by ${entry.keyid} invalid`),
      )
    }
    if (authors.keyids.includes(entry.keyid)) valid.add(entry.keyid)
  }
  if (valid.size < authors.threshold) {
    return Effect.fail(
      refuse(
        'unauthorized-item',
        `item ${item.id}: ${valid.size}/${authors.threshold} valid author signatures`,
      ),
    )
  }
  return Effect.succeed([...valid])
}
