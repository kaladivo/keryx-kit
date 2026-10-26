import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-bun'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const statements = [
    `CREATE TABLE invite_codes (
      code TEXT PRIMARY KEY, note TEXT NOT NULL, created_at TEXT NOT NULL,
      used_at TEXT, used_by TEXT)`,
    `CREATE TABLE companies (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, join_origin TEXT NOT NULL,
      contact_email TEXT NOT NULL, identity_key TEXT NOT NULL, created_at TEXT NOT NULL,
      domain_status TEXT NOT NULL DEFAULT 'not-set-up', domain_reason TEXT,
      domain_checked_at TEXT, last_timestamp_at TEXT)`,
    `CREATE TABLE signups (
      id TEXT PRIMARY KEY, invite_code TEXT NOT NULL, slug TEXT NOT NULL,
      company_name TEXT NOT NULL, join_origin TEXT NOT NULL, logo TEXT,
      contact_email TEXT NOT NULL, ops_public_key TEXT NOT NULL,
      challenge_hidden TEXT NOT NULL, challenge_visual TEXT NOT NULL,
      now TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE TABLE server_keys (
      keyid TEXT PRIMARY KEY, company_slug TEXT NOT NULL, kind TEXT NOT NULL,
      public_key TEXT NOT NULL, iv BLOB NOT NULL, ciphertext BLOB NOT NULL,
      created_at TEXT NOT NULL)`,
    `CREATE TABLE owner_challenges (
      id TEXT PRIMARY KEY, company_slug TEXT NOT NULL, challenge_hidden TEXT NOT NULL,
      challenge_visual TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE TABLE members (
      id TEXT PRIMARY KEY, company_slug TEXT NOT NULL, name TEXT NOT NULL,
      key_label TEXT NOT NULL, author_public_key TEXT NOT NULL, keyid TEXT NOT NULL UNIQUE,
      registered_at TEXT NOT NULL, UNIQUE (company_slug, key_label))`,
    `CREATE TABLE passkeys (
      credential_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, public_key BLOB NOT NULL,
      counter INTEGER NOT NULL, transports TEXT NOT NULL, iv TEXT NOT NULL,
      ciphertext TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE invites (
      id TEXT PRIMARY KEY, company_slug TEXT NOT NULL, label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      used_at TEXT)`,
    `CREATE TABLE webauthn_challenges (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, invite_id TEXT,
      name TEXT, user_id TEXT, expires_at TEXT NOT NULL)`,
    `CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, company_slug TEXT, member_id TEXT,
      expires_at TEXT NOT NULL)`,
    `CREATE TABLE ceremonies (
      id TEXT PRIMARY KEY, company_slug TEXT NOT NULL, intent TEXT NOT NULL,
      operation TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL,
      signatures TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE drafts (
      id TEXT PRIMARY KEY, member_id TEXT NOT NULL, channel TEXT NOT NULL,
      content TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE item_sources (
      company_slug TEXT NOT NULL, channel TEXT NOT NULL, item_id TEXT NOT NULL,
      source TEXT NOT NULL, PRIMARY KEY (company_slug, channel, item_id))`,
    `CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_slug TEXT NOT NULL, at TEXT NOT NULL,
      actor_kind TEXT NOT NULL, member_id TEXT, actor_name TEXT, action TEXT NOT NULL,
      summary TEXT NOT NULL, versions TEXT NOT NULL)`,
    `CREATE TABLE pilot_requests (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      message TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE fetch_counts (
      company_slug TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY (company_slug, day))`,
  ]
  for (const statement of statements) yield* sql.unsafe(statement)
})

const Migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({ '0001_initial': initial }),
})

/** `filename` is `:memory:` in tests. Migrations run when the layer is built. */
export const DatabaseLive = (filename: string) =>
  Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename })))
