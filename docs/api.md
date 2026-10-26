# Console API

The contract is `KeryxKitApi` in `packages/api` (`@keryx-kit/api`). Schemas, errors and
endpoint names there are the source of truth; this page gives the order of calls per
screen. Build the client with `HttpApiClient.make(KeryxKitApi)` and a fetch `HttpClient`.
Calls below use `group.endpoint` names.

## Conventions

- Everything lives under `https://console.<service>/api`. Sessions are `HttpOnly`,
  `Secure`, `SameSite=Strict` cookies (`keryx_owner`, `keryx_member`, `keryx_operator`).
  The browser sends them on its own, so the client sets no headers.
- Auth column: **owner**, **member**, **team** (owner or member of the company),
  **operator**, or none. A missing session answers `401 { _tag: 'Unauthorized' }`.
- Every error body is `{ _tag, error, ... }`, where `error` is a sentence to show as is.
  A body that fails to decode answers `400 InvalidRequest`.
- `Refused` (422) carries the domain refusal `code`; `RepoInvalid` (422) carries the
  `validateRepo` issues.
- Times are ISO 8601 UTC strings. Binary values are base64url.
- Key labels in public metadata are non-personal: the server labels each member's key
  `author-<n>` at registration. A member's `name` never leaves the console API.

## The signing model

The server never asks the browser to trust metadata. A ceremony (owner) or an author task
(member) carries:

- `base`: the published repo as file texts (`RepoFilesText`).
- `operation`: one `@keryx-kit/domain` call with its exact params and clock `now`.
- `toSign`: `signingBytes` of each document the server wants signed, base64url.

The browser runs `rebuild(base, operation)`, verifies the base (master keyid equals the
Trezor-derived key, `validateRepo` on the base), compares `signingBytes` of its own
document with `toSign` byte for byte, refuses on any difference, and signs its own copy.
It writes the summary the owner reads from its own rebuild, not from `summary`.

One ceremony can be open per company. Starting another answers `409 CeremonyInProgress`
with its id. The owner finishes or discards it.

Owner ceremonies make exactly one Trezor Connect call (`cipherKeyValue`), started from the
click handler (mvp-spec §5.3).

Author signing: one WebAuthn assertion with PRF (`me.credentialIds` may go in
`allowCredentials` as a hint). A site can hold several passkeys and the assertion may
return any of them, so fetch the wrapped key by the credential id it returned:
`authMember.wrappedKey` `GET /api/me/wrapped-keys/:credentialId`. `NotFound` means the
member picked a passkey that is not theirs; ask them to pick again. Unwrap (§5.4), check
the public key equals `authorPublicKey`, sign everything pending (tasks and the item),
overwrite the key.

## 1. Sign-up (A1, A2)

1. `authOwner.signup` `POST /api/signups` with invite code, `slug`, company name, join
   origin (`https://acme.com`), optional logo data URL, contact email. Returns
   `signupId`, a Trezor `challenge`, `init` (repo base, company name, logo, the new
   **ops public key**, `now`) and `expiresAt`. Errors: `LoginFailed` (invite code),
   `Conflict` (slug taken).
   - The form states the rules: the join origin is HTTPS on a hostname the company
     controls; the slug is short, readable and can never change (the Trezor shows it).
2. Click 1: Trezor `requestLogin` with `challenge` gives `{ publicKey, signature }`.
3. Click 2: Trezor `cipherKeyValue` for `"Keryx master key " + slug` gives the master seed.
4. The browser runs `initRepo({ ...init.params, masterKey }, { now: new Date(init.now) })`
   and signs `root` and `targets` with the master seed.
5. `authOwner.completeSignup` `POST /api/signups/:signupId` with `login`,
   `masterPublicKey`, `signatures: { root, targets }`. The server verifies the login,
   rebuilds the same repo, attaches, validates and writes it. Returns `201 { company }`
   and sets the owner cookie.
6. The console tells the owner the Trezor recovery seed is the backup.

## 2. Owner login

1. `authOwner.challenge` `POST /api/auth/owner/challenge` `{ company: slug }`. Returns
   `challengeId`, `challengeHidden`, `challengeVisual`. Remember the slug locally.
2. Trezor `requestLogin` with the challenge.
3. `authOwner.login` `POST /api/auth/owner/login` `{ challengeId, publicKey, signature }`.
   Sets the owner cookie. `LoginFailed` never says which part was wrong.
4. On load: `authOwner.session` `GET /api/auth/owner/session`. Logout:
   `authOwner.logout`.

The identity key is bound to the console origin, so login from localhost or another origin
fails by design.

## 3. Invite and register a member (B1, B2)

1. Owner: `team.invite` `POST /api/team/invites` `{ label }` (for the owner's eyes, e.g.
   "Jana"). Returns `url` (`https://console.<service>/invite#<token>`), shown once. Single
   use, 7 days. `team.get` lists members and pending invites.
2. Member opens the link: `authMember.invite` `GET /api/invites/:token` for the company
   name. `Expired` or `NotFound` ends the flow.
3. Check PRF support first. Without it, stop with the list of supported browsers.
4. `authMember.registrationOptions` `POST /api/auth/member/registration/options`
   `{ inviteToken, name }`. Returns `registrationId` and `publicKey` (WebAuthn creation
   options JSON with `extensions.prf`).
5. `navigator.credentials.create`, then require `prf.enabled`. Run one assertion with PRF
   `eval.first` to get the wrapping key, generate the Ed25519 author key, wrap it.
6. `authMember.register` `POST /api/auth/member/registration` `{ registrationId,
   credential, authorPublicKey, wrappedKey: { iv, ciphertext } }`. The server verifies the
   attestation. Returns `201 Me` and sets the member cookie. The member is *Registered*
   and cannot publish until assigned to a channel.

Member login: `authMember.loginOptions` (discoverable, no PRF), `navigator.credentials.get`,
`authMember.login` `{ loginId, credential }`. On load: `authMember.me`.

## 4. Create a channel (B3)

1. Owner: `ceremonies.start` `POST /api/ceremonies` `{ intent: { _tag: 'CreateChannel',
   channel, displayName, description, authors: [memberId, ...] } }`. The server generates
   the channel key. Returns `Ceremony` with `operation._tag = 'createChannel'` and one
   `toSign` for `targets`.
2. Rebuild, compare, Trezor sign (see the signing model).
3. `ceremonies.sign` `POST /api/ceremonies/:id/signatures` `{ signatures: [{ role:
   'targets', signature }] }`. Returns `status: 'staged'` with `missing` naming
   `channels.<c>.authors.json` and the authors who can sign it.
   `channels.list` shows the channel as `waiting-for-author`.
4. Author, on any console visit: `ceremonies.tasks` `GET /api/me/tasks` returns a
   `SignAuthorsMetadata` task, `reason: 'new-channel'`. Rebuild from its `base` and
   `operation`, compare `toSign`, sign `channels.<c>.authors`.
5. `ceremonies.completeTask` `POST /api/me/tasks/:taskId` `{ _tag: 'AuthorsSignature',
   signature }`. The server attaches, validates and applies the ceremony. The channel is
   `live`.

The owner can drop a ceremony with `ceremonies.discard`. `ceremonies.list` returns the
open ones for the dashboard.

## 5. Assign or remove an author (B4, B5)

Assign: `ceremonies.start` with `AssignAuthor { channel, memberId }`, then rebuild, sign,
`ceremonies.sign`. It is applied at once.

Remove:

1. `ceremonies.start` with `RemoveAuthor { channel, memberId }`. The ceremony has
   `removal: { itemsSignedOnlyByAuthor, authorsMetadataNeedsResign }`. Show both. Removing
   the last author answers `Refused` (`last-author`).
2. Remaining authors now get tasks: `ResignItems` (sign `itemSigningBytes(item)` of each
   item, complete with `{ _tag: 'ItemSignatures', signatures: [{ itemId, signature }] }`)
   and, if needed, `SignAuthorsMetadata` with `reason: 'author-removal'`.
   `ResignItems` carries no `base`. The console loads the published `targets.json` from
   `company.repoBase` and the root chain from `<company.joinOrigin>/.well-known/keryx/`
   (`root.json` and every `N.root.json`), and uses the author keys only when
   `targets.json` verifies against those roots (`validateTargets`), because the service
   controls the repo origin but not the company's domain. Without a live domain it refuses
   the task, and the `SignAuthorsMetadata` of the same removal waits with it. The console
   CSP allows `https:` in `connect-src` for this.
   `ceremonies.get` shows the impact shrinking as they do.
3. The owner signs whenever ready. Items still signed only by the removed author are
   unpublished with the revocation. If the authors metadata still needs its re-sign, the
   ceremony stays `staged` until a remaining author completes that task.

Edit channel (B6), change logo (A5) and renew `targets.json` (E3) are the same
start/sign pair with `EditChannel`, `ChangeLogo` or `RenewTargets`. Show the targets
expiry banner from `company.get` `targetsExpires` at 60, 30 and 7 days.

## 6. Publish, edit, unpublish (C1 to C5)

1. Drafts: `items.drafts`, `items.createDraft`, `items.saveDraft`, `items.deleteDraft`
   under `/api/me/drafts`. A draft holds the editor state (`DraftContent`: item id, title,
   Markdown, image data URL, tags, language), unsigned.
2. Publish: build the `ItemDraft` in the browser (Markdown to `content_html`, same
   sanitizer as the app, under 1 MB), fetch `ceremonies.tasks` first, then one passkey
   unwrap signs the item and any pending tasks.
3. `items.publish` `POST /api/channels/:channel/items` `{ item, source?, draftId? }`.
   Complete tasks with `ceremonies.completeTask`. `Conflict` means the id exists or the
   channel is not live yet; `Forbidden` means the member is not an author of the channel;
   `Refused` carries `invalid-item`, `item-too-large`, `unauthorized-item` or
   `bad-signature`.
4. Edit (C4): `items.get` returns the item and its `source`, edit it, re-sign, then
   `items.edit` `PUT /api/channels/:channel/items/:itemId`.
5. List (C3): `items.list` `GET /api/channels/:channel/items` (team).
6. Unpublish (C5): `items.unpublish` `DELETE /api/channels/:channel/items/:itemId` (team:
   an author of the channel or the owner). No signature needed.

## 7. Domain check, join kit, join link (A3, A4, D1)

1. `join.kit` `GET /api/join-kit` (owner) returns `application/zip`.
2. `company.get` has `domain: { status, reason?, checkedAt? }`. `join.checkDomain`
   `POST /api/domain-check` runs the check now. Show a banner when a `live` company drops
   to `mismatch`.
3. Join link and QR are built in the browser with `joinPayload` and `joinUrl` from
   `@keryx-kit/domain`, using `company.joinOrigin` and the chosen channels. No endpoint.

## 8. Operator (F1, F2, G2)

1. `operator.login` `POST /api/operator/login` `{ token }` with the token from the server's
   secret file. Sets the operator cookie.
2. `operator.dashboard` lists companies with domain status, last timestamp refresh and
   every metadata expiry.
3. `operator.createInviteCode` `{ note }` and `operator.inviteCodes`.
4. `operator.pilotRequests` lists landing page requests.

The landing page posts `public.requestPilot` `POST /api/pilot-requests`
`{ company, name, email, message }` (message may be `""`). It returns `201` or
`400 { error }`.

`public.release` `GET /api/release` returns `{ gitSha, consoleBundleSha256 }`: the SHA-256
of a manifest of `sha256  path` lines for every built console file, sorted by path
(mvp-spec §5.9). The console can show it in its footer.

## 9. Audit log (E4)

`company.auditLog` `GET /api/company/audit-log` (owner): who, what, when, and the metadata
versions each entry wrote.
