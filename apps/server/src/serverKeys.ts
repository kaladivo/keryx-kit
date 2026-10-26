import { ed25519Key, keyidOf, publicKeyFromSeed, type Signer, seedSigner } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { randomBytes, Vault } from './crypto.ts'
import { iso, now } from './time.ts'

const aad = (publicKey: string) => `keryx-kit/server-key/v1/${publicKey}`

export interface ServerKey {
  readonly publicKey: string
  readonly keyid: string
}

/** Ops and channel keys: generated here, stored sealed under the KEK. */
export const generateServerKey = (companySlug: string, kind: 'ops' | 'channel') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const vault = yield* Vault
    const seed = randomBytes(32)
    const publicKey = publicKeyFromSeed(seed)
    const keyid = keyidOf(ed25519Key(publicKey))
    const sealed = yield* vault.seal(seed, aad(publicKey))
    seed.fill(0)
    yield* sql`INSERT INTO server_keys ${sql.insert({
      keyid,
      company_slug: companySlug,
      kind,
      public_key: publicKey,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      created_at: iso(yield* now),
    })}`
    return { publicKey, keyid } satisfies ServerKey
  })

/** A signer for one of the company's server keys, or undefined if the keyid is not one. */
export const serverSigner = (companySlug: string, keyid: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const vault = yield* Vault
    const rows = yield* sql<{
      public_key: string
      iv: Uint8Array
      ciphertext: Uint8Array
    }>`SELECT public_key, iv, ciphertext FROM server_keys
       WHERE keyid = ${keyid} AND company_slug = ${companySlug}`
    const row = rows[0]
    if (!row) return undefined
    const seed = yield* vault.open(
      { iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) },
      aad(row.public_key),
    )
    return seedSigner(seed) satisfies Signer
  })
