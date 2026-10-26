# Product

<!-- impeccable:product-schema 1 -->

Scope: the public website of keryx-kit (`apps/site`): the landing page for businesses (`/`) and the
explainer for a company's customers (`/subscribers`). The console, server and subscriber app are
other surfaces. Written from the owner's brief and the repository; there was no live interview.
Facts marked *(inferred)* came from the brief, not from the owner directly.

## Platform

web

## Users

- **Prospect (landing page).** Someone at a company that announces things to its customers
  (security notices, product news, offers) and is tired of email phishing in its name. Often
  security-minded: finance and crypto first (`vendor/keryx/design/why.md` §2.2). They evaluate,
  forward the page to colleagues, and may present it on a projector in a meeting *(inferred)*.
  Their job: decide whether to request a pilot.
- **Subscriber (`/subscribers`).** A company's customer who followed a link from a newsletter,
  receipt or join page. Not technical. Their job: decide whether to install the app, then join
  the company safely.

## Product Purpose

Keryx replaces email as the channel a company uses to send announcements to its customers.
Customers scan a QR code, confirm the company's domain once, pick channels, and from then on every
message is signed; a message without a valid signature is never shown. No email address, no phone
number, no account, no customer list on the company's servers. keryx-kit is the hosted service
that runs it: the owner holds the master key on a Trezor, authors publish from the browser with
passkeys, the web admin uploads a join kit to the company's domain.

Success for the site: a prospect understands the mechanism and the trade-offs and requests a
pilot; a subscriber installs the app and joins without being tricked by a look-alike domain.

## Positioning

Authenticity by construction instead of user vigilance. The app shows a message only when its
signature chains to keys the company's domain authorizes; there is no "maybe" state and no warning
to click through. And there is nothing to leak: the company never learns who subscribed.
The hosted service holds the publishing keys but cannot write a message subscribers accept,
because author keys are only ever unwrapped in the author's browser (`docs/mvp-spec.md` §3).

## Operating Context

- The protocol stack is deliberately boring: HTTPS + QR + TUF + Ed25519.
- Company side: one owner with a Trezor; authors with passkeys (WebAuthn PRF); a web admin who
  uploads `.well-known/keryx/root.json`, `.well-known/keryx/1.root.json` and `join/index.html` to
  the company's domain; a join link or QR shared in newsletters, on receipts, on the website.
- Subscriber side: the PWA at `https://v1b3coder.github.io/keryx/` (any device; Safari on iPhone)
  or the Android app installed and updated through Obtainium from
  `https://github.com/v1b3coder/keryx`. No App Store app yet.
- A public demo publisher runs at `https://keryx-demo.github.io/`. Its sample content imitates a
  Trezor newsletter and states that it is not published by Trezor.

## Capabilities and Constraints

- Pilot request form: `POST /api/pilot-requests` with `{company, name, email, message}`.
- Pages are static, built with Vite, served by the keryx-kit server. CSP `script-src 'self'`: no
  inline scripts, no third-party requests at runtime (fonts and images are bundled).
- The subscriber page is generic: it never shows a company name from the URL, because an unsigned
  parameter could be used to impersonate a company (`docs/mvp-spec.md` D2).
- Honest limits that must stay on the site: the service ships the console JavaScript, so a
  compromised server could capture a key the next time someone signs; each console release
  publishes its bundle hash. Subscribers trust the company's domain at pairing. The servers that
  host the feed (the keryx-kit service, `repo.SERVICE`) see IP addresses when the app fetches
  updates. keryx-kit channels use one author signature (threshold 1); push wake-ups are out of
  scope (`docs/mvp-spec.md` §5.7, §6).

## Brand Commitments

- Name: Keryx (working title in the protocol repo). The site is the keryx-kit offer.
- Voice: plain, specific, short sentences. Say what is true and what is not covered. No hype.
- The owner rejected three earlier rounds (an editorial serif version, and two Swiss/Impeccable
  versions). The chosen direction is "Proof on the device": Mercury's calm, premium language
  around one real phone running the Keryx app, with Trezor's sticky device as the scroll story.
  Credibility beats flash.

## Evidence on Hand

- Scuffwell, a fictional shoe brand at `shoe.roguedave.codes` (`apps/demo-shoe`), is the demo
  company on both pages. Its posts were signed into a local repo with `packages/domain` and seed
  signers, served over HTTPS for `shoe.roguedave.codes` and `repo.keryx-kit.roguedave.codes`, and
  the real subscriber app (`vendor/keryx/app`, Vite dev) paired with it. Captures at 390×797 @2x,
  light and dark (`src/assets/phone-*.webp`): scan (fake camera feed of a printed Scuffwell card
  with the real join QR), confirm, channel picker, feed. The greyed-out fake
  (`phone-spoof-*.webp`) is a recreation in the app's own classes, a forged post claiming to be from
  Scuffwell (no sender domain shown); the app never renders it.
- The console editor (`src/assets/editor-*.webp`) is a capture of `apps/console` in mock mode with
  Scuffwell seed data, an author registered with a virtual passkey, and the Karlín pop-up post.
- The signature check showcase uses Scuffwell's Puddle sale post (without its image), signed with
  a local demo author key (`src/demo-item.ts`), not a production key. The small feed beside it is
  a recreation: an HTML card in the app's metrics over the real feed capture.
- The landscape and object images are generated (Codex image generation) and carry no text, logos
  or brand marks.
- The Android release certificate fingerprint (`vendor/keryx/README.md`).
- Source: GPL-3.0 at `https://github.com/v1b3coder/keryx`.
- Absent, never to be invented: customers, logos, testimonials, statistics, prices, audits,
  certifications, dates of availability.

## Product Principles

1. Show the real thing (screens, files, signatures) before describing it.
2. State the limits next to the claims, in the same type size.
3. One decision for the subscriber: check the domain. Everything else is automatic.
4. Nothing to leak beats protecting what you keep.

## Accessibility & Inclusion

WCAG 2.2 AA: semantic landmarks and headings, visible focus, 4.5:1 body contrast, alt text on
every screenshot, `prefers-reduced-motion`, light and dark themes following the system setting,
usable at 390 px wide and presentable full-screen at 1280×720 and 1920×1080.
