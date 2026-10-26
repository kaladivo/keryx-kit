# Spikes

## Custody spike: Trezor master key, owner login, passkey PRF

Goal: confirm the two browser capabilities the custody design (`docs/mvp-spec.md` §3, §5.3,
§5.4) depends on, before building on them. Code: `apps/spike` (throwaway Vite page, three
tests with visible PASS/FAIL, Playwright specs in `apps/spike/e2e`).

Versions used:

- `@trezor/connect-web` 10.0.1 and `@trezor/connect` 10.0.1 (latest on npm, 2026-10-26)
- Emulator: `ghcr.io/trezor/trezor-user-env:latest` (arm64), model **T3W1 (Trezor Safe 7)**,
  firmware **2.13.0**, node-bridge 3.2.1, seed `all all … all` (12 words), no PIN, no passphrase
- Suite Web: production `https://suite.trezor.io/web/connect-popup` as of 2026-10-26
- Playwright 1.64.1, Chromium (Playwright build)

### Results

| Test | Emulator, in-page Connect core + Bridge (Chromium) | Emulator, `connect-web` → Suite Web popup (Chromium) | Real Safe 7, Chrome | Real Safe 7, Firefox + Suite desktop | Phones |
|---|---|---|---|---|---|
| 1. Owner login (`requestLogin`) | pass | pass | untested (manual) | untested | n/a |
| 2. Master key (`cipherKeyValue`) | pass | pass | untested (manual) | untested | n/a |

| Test | Chromium + CDP virtual authenticator (`hasPrf`) | Chrome + Google PM | Chrome + iCloud Keychain | 1Password | YubiKey | Edge | Safari 18+ | Firefox | Phones |
|---|---|---|---|---|---|---|---|---|---|
| 3. Passkey PRF wrap/unwrap | pass | untested | untested | untested | untested | untested | untested | untested | untested (needs HTTPS domain) |

Emulator values (same seed, so they reproduce on every run):

- Identity public key for origin `http://localhost:5173`: `034fc5001f0ecd6ef70f64e3f1ef0d6feb97f542c313a25954aa2834054b51a846`
- Master Ed25519 public key for `company_id = acme-spike`: `4a4db0b38c20e3746ea6c33cb99e5334b7e3c7a75199250bc74dbf4770b080c2`
- For `acme-spike-other`: `f9b9085e35017e0cc8e22886127047c72dcaee9a9a4aacdcf13d188ad0e033f4`

Both Connect paths produced byte-identical keys, and the master key stayed the same across a
page reload (new THP session).

### Exact parameters

Owner login (`requestLogin`, SLIP-0013):

- `challengeHidden`: 32 random bytes, hex. `challengeVisual`: `YYYY-MM-DD HH:MM:SS` (UTC).
- `origin`: the page origin. Suite Web ignores it and uses the verified caller origin (see below).
- Verification in the page: digest = SHA-256d(`"\x18Bitcoin Signed Message:\n"` ‖ `0x40` ‖
  SHA-256(challengeHidden bytes) ‖ SHA-256(UTF-8 challengeVisual)). The signature is 65 bytes,
  header ‖ r ‖ s, header = 31 + recovery id. Verify secp256k1 ECDSA against `publicKey`
  (33-byte compressed) and check the recovered key equals it. A different challenge fails.

Master key (`cipherKeyValue`, SLIP-0011), exactly as in §5.3:

- `path`: `m/10016'/0`
- `key`: `"Keryx master key " + company_id`
- `value`: `c845593e08a1c9220cc24513f68fa275e370381e5704cb666af129b435ebf470`
  (= SHA-256(`"keryx/master-key/v1"`))
- `encrypt: true`, `askOnEncrypt: true`, `askOnDecrypt: true`, no `iv`
- Output: 32 bytes, used as the Ed25519 seed (`@noble/ed25519` 3.2.0).

Passkey PRF (§5.4):

- Registration: `residentKey: 'required'`, `userVerification: 'required'`, algs -7 and -257,
  `extensions: { prf: {} }`. Checks `getClientExtensionResults().prf.enabled === true`.
- Assertions: `prf.eval.first` = UTF-8 bytes of `"keryx/author-key/v1"` (the browser hashes
  it with the `"WebAuthn PRF\0"` context itself). One discoverable assertion
  (`allowCredentials: []`), one with the credential id. Both outputs are 32 bytes and equal.
- Wrapping key: HKDF-SHA256, ikm = PRF output, salt = 32 zero bytes,
  info = `"keryx/author-key/v1/aes-256-gcm"`, non-extractable AES-256-GCM key.
- Wrap: AES-256-GCM, random 12-byte IV, AAD = the author's Ed25519 public key. Unwrap with the
  key from the second assertion, compare, sign and verify a message, zero the buffers.

### Findings and proposed spec changes

1. **Connect 10 always goes through Trezor Suite.** `@trezor/connect-web` 10 no longer hosts a
   Connect core in an iframe. It talks to Suite desktop over a loopback WebSocket, or opens
   Suite Web (`suite.trezor.io`) in a popup. The console never talks WebUSB itself. Suite Web
   reaches the device over WebUSB (Chromium) or the Bridge (`127.0.0.1:21328`, bundled with
   Suite desktop). Both methods are in the public API with no firmware restriction for T3W1
   (`connect-core` `data/config.js`), and both need the `sign` permission.
   *Spec fix (§5.3):* replace "confirm in Chrome and with Trezor Suite on Firefox" with: the
   console uses `@trezor/connect-web` with `coreMode: 'auto'`. Supported: any browser with Suite
   desktop running; Chromium with Suite Web over WebUSB. Firefox and Safari have no WebUSB, so
   they need Suite desktop (or a standalone Bridge).
2. **Hosting headers.** The console must not send `Cross-Origin-Opener-Policy: same-origin`
   (use `same-origin-allow-popups`), and its CSP needs `frame-src https://suite.trezor.io`.
   Missing headers surface as a handshake timeout. *Spec fix (§5.1 Caddy config, §5.9).*
   In headless Chromium the Suite Web bootstrap iframe also failed with
   `Handshake_Error storage-access-denied`, and Chrome blocked `suite.trezor.io` →
   `127.0.0.1:21328` under Local Network Access. The automated test grants `storage-access`
   and `local-network-access` and disables those two Chrome features. Real Chrome may show a
   permission prompt for either. The manual test below checks what the user sees.
3. **Prompt count per ceremony.** Through Suite, each Connect call shows a Suite permission
   prompt ("Allow transaction and data signing on Trezor", with an optional "Always allow for
   this app") and then the device confirmation. On a Safe 7 the first connection from a browser
   also needs THP pairing: confirm on the device, then type a 6-digit code into Suite. One
   ceremony needs one `cipherKeyValue` call, so one Suite prompt and one device confirmation.
4. **Owner login is bound to the caller origin by Suite.** With the page passing
   `origin: https://keryx-kit.roguedave.codes` from `http://localhost:5173`, the device still
   showed `Sign HTTP / <challengeVisual> / localhost:5173` and returned the same identity key as
   the unspoofed call. A phishing page therefore gets a different identity key. Consequences:
   the identity key is per origin, so the server stores it for the console origin
   (`https://console.keryx-kit.roguedave.codes`), dev on localhost gets a different key, and
   moving the console to another origin breaks owner login. *Spec fix (§5.3):* say this, and
   say the server verifies the signature against the identity key stored at onboarding (the
   verification code is in `apps/spike/src/ownerLogin.ts`).
5. **The master key depends on the Suite wallet (passphrase).** Suite now picks the active
   device and wallet; Connect calls do not ask for a passphrase. `cipherKeyValue` runs in the
   active wallet, so a hidden (passphrase) wallet gives a different master key. `requestLogin`
   always uses the empty passphrase. *Spec fix (§5.3, §5.5 step 4):* the browser derives the
   seed, computes the public key, and refuses to sign unless its keyid is the master keyid in
   the current `root.json`, telling the owner to switch Suite to the wallet used at onboarding.
6. **`company_id` is shown on the device.** The Safe 7 shows `Encrypt value / Keryx master key
   <company_id>`. Use a short readable id (slug), not a UUID. `askOnEncrypt` and `askOnDecrypt`
   are hashed into the key on the device, so these flags, `path`, `key` and `value` must never
   change. *Spec fix (§5.3):* fix `value` to SHA-256(`"keryx/master-key/v1"`) in
   `packages/domain`, and state that the four parameters are frozen.
7. **§5.4 leaves HKDF and AES-GCM details open.** *Spec fix:* PRF `eval.first` = UTF-8
   `"keryx/author-key/v1"`; HKDF-SHA256 with salt = 32 zero bytes and info =
   `"keryx/author-key/v1/aes-256-gcm"`; AES-256-GCM with a random 12-byte IV stored next to the
   ciphertext; AAD = the author public key, so a ciphertext cannot be moved to another author.
   The server stores credential id, author public key, IV and ciphertext.
8. **Emulator-only noise.** Suite shows a "device compromised" banner for the emulator
   firmware. Real devices should not show it.

### Rerun the automated checks

Docker and Bun required. Ports are moved off 9001 and 21328 so a running Trezor Suite desktop
(whose Bridge owns 21328) does not collide; override with `TENV_CONTROLLER` and
`TENV_BRIDGE_PORT`, and the emulator with `TENV_MODEL` and `TENV_FIRMWARE`.

```sh
bun install
cd apps/spike
bunx playwright install chromium
bun run tenv:up          # trezor-user-env: controller :19001, Bridge :21330, emulator screen http://localhost:16080/vnc_embed.html
bun run test:e2e         # passkey.spec, trezor.spec (in-page core), suite-web.spec (needs internet)
bun run tenv:down
```

`suite-web.spec.ts` drives the production Suite Web popup and reroutes its Bridge requests to
the emulator, so it depends on `suite.trezor.io` staying as it is today.

### Manual test with the real Safe 7

Desktop, Chrome, on the machine with the Safe 7 plugged in by USB:

```sh
bun install
cd apps/spike && bun run dev
```

1. Quit Trezor Suite desktop and open `http://localhost:5173/?trezor=suite-web`.
2. **Owner login**: press Run. Check that Chrome asks about storage access or local network
   access (note the wording; the console's onboarding will need to explain it). In the Suite
   popup check the app is shown as "keryx-kit spike / http://localhost:5173", then confirm. On
   first use pair the device (confirm on the Safe 7, type its code into Suite). The Safe 7
   should show `Sign HTTP`, the same timestamp as `challengeVisual` in the page, and
   `localhost:5173`. The page should show PASS and the identity public key.
3. **Master key**: press Run. Suite permission, then three device screens:
   `Encrypt value / Keryx master key acme-spike` twice, then `… acme-spike-other`. Expect PASS.
   Note the master public key, reload, run again: it must be the same.
4. Passphrase check: switch Suite to a hidden wallet, run the master key test, and confirm the
   key differs (finding 5). Switch back.
5. Origin check: open `http://localhost:5173/?trezor=suite-web&loginOrigin=https://keryx-kit.roguedave.codes`
   and run Owner login. The device must still show `localhost:5173`, with the same identity key.
6. Start Trezor Suite desktop and repeat 2 and 3 with `?trezor=auto` (the production setting).
   The approval now appears in Suite desktop.
7. Optional, Firefox with Suite desktop running: `?trezor=auto`, tests 1 and 2.
8. Optional: `?trezor=webusb` runs the Connect core inside the page over WebUSB, without Suite.
   This is not the production path; it shows whether direct WebUSB works with THP pairing.

Passkey PRF (test 3), same page, any mode. Run it once per authenticator you want to cover
(Chrome with Google Password Manager, iCloud Keychain, 1Password, a YubiKey; Edge; Safari 18+;
Firefox) and record PASS/FAIL. When it fails, the log shows which step failed: no
`prf.enabled` at registration, no PRF output on assertion, or a mismatch.

Still to do on phones: WebAuthn on a phone needs an HTTPS origin, so the PRF test on iOS Safari
and Android Chrome (and passkeys synced to the phone) waits for the deployed
`keryx-kit.roguedave.codes` domain. On phones Connect goes through `@trezor/connect-mobile`
and the Suite mobile app, which the spike does not cover.
