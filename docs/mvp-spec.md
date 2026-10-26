# Keryx MVP: user stories and specification

Status: draft, 2026-10-26.

The protocol is defined in `vendor/keryx/spec/` and stays normative. This document
covers only the hosted service built on top of it. Where the two disagree, the
protocol wins and this document gets fixed.

## 1. What we are building

A hosted service that lets a company run Keryx without touching a CLI. It is
the pilot offer for stakeholders, so it has to work end to end on one VPS.

| # | Deliverable | Audience |
|---|---|---|
| D1 | Landing page | Businesses (B2B) evaluating Keryx |
| D2 | Publisher console + backend | Company owners and authors |
| D3 | Subscriber explainer page | The company's customers, linked from newsletters |
| D4 | Join kit | The company's web admin, uploads it to the company origin |

The subscriber app already exists (`vendor/keryx/app`, PWA + Android) and is not
part of this work. It must stay on its own origin and deploy pipeline (§5.9).

## 2. Roles

| Role | Who | Authenticates with |
|---|---|---|
| Owner | One person per company who holds the Trezor | Trezor (SLIP-0013 login) |
| Author | Marketing or comms people who write and sign posts | Passkey (WebAuthn with PRF) |
| Subscriber | The company's customer | Nothing. No account exists |
| Operator | Us, running the VPS | Separate admin login |
| Prospect | A business visiting the landing page | Nothing |

An owner may also register as an author. That is a separate passkey identity.

## 3. Key custody

| Key | Lives | Protected by | Signs |
|---|---|---|---|
| Master | Nowhere at rest. Derived on demand from the Trezor | On-device confirmation | `root.json`, `targets.json` |
| Ops | Server | Server key-encryption key (KEK) | `snapshot.json`, `timestamp.json` |
| Channel (one per channel) | Server | Server KEK | `channels.<c>.json` |
| Author (one per author) | Server stores it wrapped | Author's passkey (PRF) | Items, `channels.<c>.authors.json` |

All channels are authored channels (`spec/feeds.md` §2). Simple mode is off,
because in simple mode the channel key signs items and the server could forge
them.

What this buys: the server holds the ops and channel keys, so it can withhold
or unpublish, but it cannot create an item subscribers will accept. Forging an
item needs an author key, and those are only ever unwrapped in the author's
browser.

What it does not buy: the server ships the console JavaScript. A compromised
server could serve code that captures an author key or a master key the next
time someone signs. We accept this for the MVP and say so on the trust page
(D3) and the landing page (D1).

## 4. User stories

Priority: **M** must have for the stakeholder demo, **S** should have for a
pilot, **C** could have.

### A. Company onboarding

**A1 (M). Sign up a company.** As an owner, I want to create a company account
with an invite code from the operator, so that only pilot companies get in.
- Input: invite code, company name, join origin (e.g. `acme.com`), logo
  (uploaded file, embedded as a data URL), contact email (for the operator
  only, never used for login).
- The join origin must be HTTPS and a hostname the company controls. The
  console states this rule on the form.
- The owner connects the Trezor and completes SLIP-0013 login. That Trezor
  identity becomes the owner's login.

**A2 (M). Create the master key.** As an owner, I want my master key bound to
my Trezor, so that nobody, including the service, can change who is allowed to
publish for my company.
- The browser derives the master key from the Trezor (§5.3). The Trezor screen
  asks for confirmation.
- The server generates the ops key.
- The browser builds and signs `root.json` v1 (master as root and targets, ops
  key as snapshot and timestamp, `custom.repo_base`, `mode: full`) and
  `targets.json` v1 (company name and logo, no channels yet).
- The server validates, signs snapshot and timestamp, and writes the repo.
- The console tells the owner that their Trezor recovery seed is the backup.
  Losing both the device and the seed means a new company identity, and every
  subscriber has to pair again.

**A3 (M). Download the join kit.** As an owner, I want a zip I can hand to my
web admin, so that my domain becomes the trust anchor.
- Contents: `.well-known/keryx/root.json`, `.well-known/keryx/1.root.json`,
  `join/index.html` (§5.6), and a README with header snippets for nginx,
  Apache, Cloudflare and Netlify.
- Required headers: `Access-Control-Allow-Origin: *` on
  `/.well-known/keryx/*` (the PWA fetches it cross-origin),
  `Content-Type: application/json`, and `Referrer-Policy: no-referrer` on
  `/join`. The README also says to redact the `p` query parameter from access
  logs (`spec/core.md` §3).

**A4 (M). Check my domain.** As an owner, I want the console to tell me when my
domain is set up correctly, so that I know when I can announce the channel.
- The server fetches `https://<origin>/.well-known/keryx/root.json` and every
  `N.root.json`, compares bytes with the current root, checks the CORS header,
  and checks that `/join` returns the kit page.
- Status: *Not set up*, *Mismatch* (with the reason), *Live*.
- Rechecks daily. A *Live* company that drops to *Mismatch* gets a console
  banner and appears on the operator dashboard.

**A5 (S). Change the logo.** As an owner, I want to update the logo, so that
the app shows our current brand.
- Trezor ceremony on `targets.json`. Subscribers see a one-tap acknowledgement
  (`spec/core.md` §2).

**A6 (C). Change the company name.** Allowed, but the console warns that every
subscriber must scan a fresh QR code before they see content again.

### B. Team and channels

**B1 (M). Invite a team member.** As an owner, I want to send an invite link,
so that marketing people can get author keys.
- Invite links are single-use and expire after 7 days.

**B2 (M). Register as an author.** As an invited member, I want to create my
account with a passkey, so that my signing key is mine alone.
- The browser creates a passkey with the PRF extension, generates an Ed25519
  author key, wraps it with the PRF output (§5.4), and uploads only the
  wrapped key and the public key.
- If the browser or passkey provider does not support PRF, registration stops
  with a clear message listing supported browsers. There is no fallback.
- The member is now *Registered*. They cannot publish until the owner assigns
  them to a channel.

**B3 (M). Create a channel.** As an owner, I want to create a channel and pick
its first authors, so that my team can start publishing.
- Input: slug (`[a-z0-9-_]+`), display name, description, one or more
  registered members as authors.
- The server generates the channel key.
- The browser builds `targets.json` v+1 with the `channels.<c>` delegation
  (channel key, `channels/<c>/*`, terminating) and the `channels.<c>.authors`
  delegation (author keys, threshold 1), then signs with the master.
- The server stages the change. It goes live once one of the authors signs
  `channels.<c>.authors.json` v1, which happens automatically the next time
  that author is in the console (§5.5). Until then the channel shows *Waiting
  for an author*.

**B4 (M). Assign an author to a channel.** As an owner, I want to add a
registered member to a channel, so that they can publish there.
- Trezor ceremony on `targets.json`. Live immediately, because the existing
  authors metadata signature stays valid.

**B5 (S). Remove an author.** As an owner, I want to revoke an author (for
example when they leave the company), so that their key stops working.
- The console lists the published items signed only by that author.
- Remaining authors of the channel get a *Re-sign N items* task. Re-signing
  adds their signature to each item.
- If `channels.<c>.authors.json` was signed by the removed author, a remaining
  author re-signs it too.
- The owner then signs the revocation with the Trezor. The server applies it
  together with an unpublish of any item still signed only by the revoked key,
  because subscribers would reject those items anyway.
- Removing the last author of a channel is not allowed.

**B6 (S). Edit channel display name and description.** Trezor ceremony on
`targets.json`.

**B7 (C). Delete a channel.** Trezor ceremony removing both delegations.

### C. Publishing

**C1 (M). Write a post.** As an author, I want to write a post in a simple
editor, so that I can publish without knowing HTML.
- Fields: title, body (Markdown, converted to `content_html` in the browser),
  optional preview image, tags, language, item id (prefilled as a slug from
  the title, editable).
- Images are resized in the browser and embedded as data URLs. The editor
  blocks saving above 1 MB per item (`spec/feeds.md` §1.1).
- The preview uses the same sanitizer configuration as the subscriber app, so
  what the author sees is what subscribers see.
- Drafts are saved on the server unsigned.

**C2 (M). Sign and publish.** As an author, I want to publish with one passkey
prompt, so that the post reaches subscribers right away.
- The browser unwraps the author key, signs the item (OLPC canonical JSON
  without `sig`, `spec/feeds.md` §1.2), and discards the key.
- The server verifies the signature against the authors role, adds the
  target, signs `channels.<c>.json`, snapshot and timestamp, and writes the
  repo atomically.
- Subscribers get the post at the app's next sync. Push wake-ups are
  deferred (§5.7).

**C3 (M). See what is published.** As an author or owner, I want a list of
published items per channel, so that I know what subscribers have.

**C4 (S). Edit a published post.** Same `id`, re-signed by the editing author.
Subscribers see an in-place update.

**C5 (S). Unpublish a post.** As an author of the channel or as the owner, I
want to unpublish an item, so that it disappears from subscribers' inboxes.
Needs no personal signature, because the channel key does it on the server.

### D. Reaching subscribers

**D1 (M). Get a join link and QR code.** As an owner or author, I want a join
URL and QR code with chosen channels preselected, so that I can put it in a
newsletter, on a receipt or on the website.
- Output: join URL, QR as PNG and SVG, and an HTML snippet (button plus link
  to the explainer page) to paste into a newsletter.
- The console warns when the QR gets too dense to print on receipts
  (`spec/core.md` §3 size policy).

**D2 (M). Explainer page for subscribers.** As a subscriber who saw a link in
a newsletter, I want a plain explanation, so that I can decide whether to
install the app.
- Covers what Keryx is, how to install it (PWA, Android via Obtainium), how to
  join (scan, check that the domain shown is exactly the company's domain,
  pick channels), and why to trust it: no email, no phone number, no account,
  signed messages, open source, and "this channel never asks for a password,
  seed or code".
- It also states the limits honestly: you trust the company's domain at
  pairing, and the hosting service could be attacked.
- The page is generic. It never shows a company name from a URL parameter,
  because an unsigned parameter could be used to impersonate a company.

### E. Running the service

**E1 (M). Fresh timestamps.** The server re-signs `timestamp.json` on a
schedule so subscribers never see stale metadata (§5.8).

**E2 (M). Auto-renew server-signed metadata.** Snapshot and channel metadata
are re-signed before they expire.

**E3 (M). Expiry reminders for human-signed metadata.** `targets.json` (365
days, Trezor) and `channels.<c>.authors.json` (180 days, author passkey)
cannot renew themselves.
- Authors re-sign the authors metadata automatically during any publish or
  console visit once it is within 60 days of expiry.
- The owner gets a console banner at 60, 30 and 7 days before `targets.json`
  expires. The operator dashboard shows the same dates.

**E4 (S). Audit log.** As an owner, I want a log of every ceremony and
publish (who, what, when, metadata versions), so that I can review activity.

**E5 (C). Reach estimate.** As an owner, I want a rough daily count of
`timestamp.json` fetches, so that I can see whether people use the channel.
No IPs or identifiers are stored, only the daily count.

### F. Operator

**F1 (M). Issue invite codes.**

**F2 (M). Operator dashboard.** Companies, domain status, last timestamp
refresh, metadata expiry dates.

**F3 (S). Encrypted backups.** Daily encrypted backup of the database and
repo directory to off-site storage, with a tested restore.

### G. Landing page

**G1 (M). Explain Keryx to businesses.** As a prospect, I want to understand
what Keryx replaces and why it is safer, so that I can decide whether to pilot
it.
- Sections: the problem (phishing, leaked customer lists, ESP risk), how it
  works in three steps, what the company has to do (Trezor, upload the kit,
  share the QR), the security model in plain words including the hosted-JS
  caveat, and a pilot call to action.

**G2 (M). Request a pilot.** A form (company, name, email, message) stored on
the server and shown on the operator dashboard.

## 5. Specification

### 5.1 Architecture

One Bun monorepo (Bun as package manager and runtime), TypeScript and Effect throughout:

| Package | Contents |
|---|---|
| `packages/domain` | OLPC canonical JSON, keyid, TUF metadata types and builders, item schema, join payload, Effect Schemas for the API. Runs in Node/Bun and the browser |
| `apps/server` | Effect HTTP API, SQLite, scheduled jobs, repo writer |
| `apps/console` | React + Vite publisher console (D2) |
| `apps/site` | Static landing page (D1) and explainer page (D3) |
| `packages/join-kit` | The static `join/index.html` template and kit builder (D4) |

Start `packages/domain` from `vendor/keryx/app/src/lib` (`olpc.ts`, `item.ts`,
`payload.ts`, `tuf.ts`). Port the write side from `vendor/keryx/sdk/tufrepo` and
`vendor/keryx/sdk/publisher`.

Release and deployment:

- One Docker image with the Bun server, which also serves the built console,
  site and repo directory, routing by `Host`. SQLite and the repo directory
  live on a mounted volume. The KEK is a mounted file.
- GitHub Actions runs tests and the Go conformance check on every push. On
  `main` it builds the image, pushes it to GHCR, and deploys it to the
  DigitalOcean droplet over SSH (`docker compose pull && docker compose up
  -d`).
- On the droplet, Caddy (official image) terminates TLS in front of the app.
  Its config lives in this repo.

### 5.2 URLs

| URL | Serves |
|---|---|
| `https://SERVICE/` | Landing page |
| `https://SERVICE/subscribers` | Explainer page |
| `https://console.SERVICE/` | Publisher console and API |
| `https://repo.SERVICE/<company>/` | Repo base per company (`custom.repo_base`) |
| `https://<company origin>/.well-known/keryx/` | Root anchor, uploaded by the company |
| `https://<company origin>/join` | Join page from the kit |
| Existing GitHub Pages PWA | Subscriber app (unchanged) |

`SERVICE` is `keryx-kit.roguedave.codes` (§8).

The repo base gets its own origin so console cookies never reach it. It serves
static files with `Access-Control-Allow-Origin: *` and `Cache-Control:
no-cache` on `timestamp.json`.

### 5.3 Master key from the Trezor

The master key is never stored. The browser derives it each time through
Trezor Connect `cipherKeyValue`:

- `path`: a SLIP-0011 path such as `m/10016'/0`
- `key`: `"Keryx master key " + company_id`
- `value`: a fixed 32-byte constant from `packages/domain`
- `encrypt: true`, `askOnEncrypt: true`, `askOnDecrypt: true`

The 32-byte output is the Ed25519 seed. The result is deterministic, so the
Trezor recovery seed is the full backup and no wrapped blob exists. Including
`company_id` in `key` means one Trezor can own several companies with
unrelated keys.

The browser keeps the seed only for the duration of one ceremony and
overwrites the buffer afterwards.

Owner login is a separate Trezor Connect `requestLogin` (SLIP-0013) with a
server challenge. It never derives the master key.

Spike first: confirm in Chrome and with Trezor Suite on Firefox that
`cipherKeyValue` behaves as above on the Trezor Safe 7 (the device we demo with) and in the emulator.

### 5.4 Author key wrapping

- Registration creates a discoverable passkey with the `prf` extension.
- The wrapping key is `HKDF-SHA256(prf(salt = "keryx/author-key/v1"))`. The
  author key is encrypted with AES-256-GCM.
- The server stores the credential id, the public key, and the ciphertext.
- Signing runs one WebAuthn assertion with PRF, unwraps, signs, and
  overwrites the key buffer.
- A lost passkey means a lost author key. The owner removes the author (B5)
  and the member registers again (B2).

Spike first: confirm PRF in Chrome, Edge and Safari 18+, with iCloud Keychain,
Google Password Manager, 1Password and a YubiKey. Record what Firefox does.

### 5.5 Ceremonies

Every change to `root.json` or `targets.json` follows the same flow:

1. The owner starts the action in the console.
2. The server builds the unsigned new metadata and returns it together with a
   readable summary ("Add author Jana to channel Offers").
3. The browser rebuilds the metadata from the current published version plus
   the intended change, compares it byte for byte with what the server sent,
   and refuses to sign on any difference. The summary the owner reads is
   generated from the browser's own copy.
4. The Trezor confirms the derivation. The browser signs and sends the
   signature.
5. The server validates the whole repo with the change applied (signatures,
   thresholds, monotonic versions, authors and channel keyids disjoint,
   `spec/repository.md` rules) and applies it only if the result is valid.
   Otherwise it keeps the change *Staged* with the missing pieces listed, for
   example an authors metadata signature (B3, B5).

Step 3 matters because it limits what a compromised API can trick a working
console into signing. It does not help against a compromised console bundle
(§3).

### 5.6 Join kit page

`join/index.html` is one static file, the same for every join URL:

- No third-party resources. The QR library is inlined.
- `<meta name="referrer" content="no-referrer">`.
- Reads `p` from its own URL and builds an "Open in Keryx" link to the PWA
  deep link `?domain=<origin host>&p=<p>` (`vendor/keryx/app/src/App.tsx`).
- Shows a QR of its own URL for desktop visitors, Android install
  instructions, and a link to the explainer page.
- Shows no company name or logo.

### 5.7 Push wake-ups

Deferred. When added, the server sends a public-scope wake-up to the existing
relay after each publish or unpublish, signed with the channel key
(`vendor/keryx/relay/SPECIFICATION.md` §3 to §5).

### 5.8 Scheduled jobs

| Job | Cadence |
|---|---|
| Re-sign `timestamp.json` | Every 12 h, using the SDK's default expiry |
| Re-sign snapshot and channel metadata nearing expiry | Daily, when under 7 days (snapshot) or 30 days (channel) remain |
| Domain check (A4) | Daily |
| Expiry reminders (E3) | Daily |
| Backup (F3) | Daily |

### 5.9 Security requirements

- The server never receives a master or author private key. API schemas have
  no field that could carry one.
- The ops and channel keys are encrypted at rest with a KEK read from a file
  outside the database and the repo directory (mode 0400).
- Console CSP: `script-src 'self'`, no inline scripts, no third-party scripts.
  `frame-src` and `connect-src` allow only Trezor Connect.
- Console sessions use `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
  Login endpoints are rate limited.
- Each console release publishes the bundle hash, so a changed bundle is at
  least detectable.
- The subscriber PWA stays on a separate origin and a separate deploy
  pipeline. If the service hosted it, a server compromise could change what
  subscribers see for every company, not just steal publisher keys.

### 5.10 Data model (outline)

The repo directory holds the signed metadata and items. SQLite holds
everything else:

`companies`, `owners` (Trezor login identity), `members` (passkey credential,
author public key, wrapped key), `channels`, `channel_authors`, `drafts`,
`staged_changes`, `server_keys` (encrypted ops and channel keys),
`audit_log`, `invites`, `pilot_requests`, `domain_checks`, `fetch_counts`.

### 5.11 Testing

- `packages/domain` golden tests: OLPC bytes, keyids and signatures match the
  Go SDK output for the same inputs.
- Conformance: CI generates repos with the TypeScript publisher and verifies
  them with the Go SDK (`pub validate`, the go-tuf client) and with the
  subscriber app's `tuf.ts`. A repo that any of them rejects fails the build.
- End to end: the demo script in §7, automated with a Trezor emulator and a
  WebAuthn virtual authenticator.

## 6. Out of scope

Private per-order feeds, thresholds above 1, simple mode, lite mode, root and
ops key rotation UI, channel key rotation, push wake-ups, more than one owner
per company, billing, email notifications, a company directory, and changes to the
subscriber app.

## 7. Demo script

This is the acceptance test for the stakeholder presentation:

1. Sign up "Demo Shop" on a domain we control, with a Trezor.
2. Download the join kit, upload it, and watch the domain check turn *Live*.
3. Invite an author, who registers with a passkey on a second device.
4. Create the channel "Offers" with that author. It goes live after the
   author's first console visit.
5. The author writes a post with an image and publishes it.
6. On a phone, open the newsletter snippet, install the PWA, confirm the
   domain, subscribe, and see the post.
7. Edit the post and show the in-place update on the phone.
8. Show the explainer page and the landing page.

## 8. Decisions

1. `SERVICE` is `keryx-kit.roguedave.codes` for the MVP.
2. English only: landing page, explainer page and console.
3. Runtime: Bun, with Effect.
4. No approval step before publishing. An author publishes directly.
5. The daily fetch count (E5) is the reach metric for the pitch.
6. The landing page shows no pricing, only "request a pilot" (G2).
