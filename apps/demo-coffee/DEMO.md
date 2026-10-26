# Onboarding demo: Kindlewood Coffee

A coffee shop joins Keryx live, from sign-up to a customer's phone, in about 13 minutes.
Kindlewood Coffee is fictional. Its website is https://coffee.roguedave.codes (this app).

## Cast and devices

- **Presenter laptop** on the projector: Chrome with Trezor Suite, the Trezor, a terminal in the
  repo root. You are the owner here.
- **Author device**: a second browser profile or a second laptop, with a passkey provider that
  supports PRF (the console refuses others, so test it in rehearsal). You play Marta, who writes
  the shop's news.
- **Phone**: the customer. Any phone browser.

## Values to type

| Field | Value |
|---|---|
| Console | https://console.keryx-kit.roguedave.codes/signup |
| Invite code | a fresh one from the operator screen (each code works once) |
| Company name | `Kindlewood Coffee` |
| Company slug | `kindlewood-coffee` (prefilled from the name; it can never change) |
| Join origin | `coffee.roguedave.codes` (the form adds `https://`) |
| Contact email | `roastery@coffee.roguedave.codes` (operator only, never used to sign in) |
| Logo | `apps/demo-coffee/brand/kindlewood-logo-512.png` (512 × 512 PNG; the logo field does not take SVG) |
| Invite label | `Marta, roastery` |
| Author name | `Marta` |
| Channel 1 | `orders` · Order & delivery notices · description below |
| Channel 2 | `roasts` · Fresh roasts · description below |
| Stage post | `posts/orders-2-new-payment-provider.md` with `posts/images/new-payment-provider.jpg` |

Channel descriptions, to paste:

- orders: `Shipping delays, holiday hours and changes to how you pay. We will never ask for your card details, a password or a code.`
- roasts: `New coffees, seasonal blends and brewing tips from our Brno roastery. About twice a month.`

## Stage script

Times are rough and cumulative. Each "Say" is one line; reword freely.

1. **Show the shop (0:00, 30 s).** Open https://coffee.roguedave.codes, scroll to "Get our news
   in Keryx", click it. `/join` says "Our Keryx channels open soon."
   Say: "This is a small roastery. Today they send order notices by email, and so do the people
   pretending to be them."

2. **Sign up (0:30, 90 s).** Console → Sign up. Type the invite code, company name, check the
   slug, join origin, contact email, pick the logo PNG. Click **Continue**.
   Say: "The company name and logo go into metadata only the owner's Trezor can sign."

3. **Trezor login and master key (2:00, 90 s).** **Sign in with Trezor**, confirm in Suite and on
   the device. Then **Create master key and sign**; the device shows
   `Encrypt value` with the slug. The done screen shows the master key fingerprint.
   Say: "The master key comes from this Trezor. The service never sees it and cannot publish as
   Kindlewood."

4. **Download the kit (3:30, 20 s).** **Go to your console** → Overview → Join kit → **Download
   zip**. Chrome saves `keryx-join-kit-kindlewood-coffee.zip` to Downloads. The Domain card says
   *Not set up*.
   Say: "This zip is what the shop hands to whoever runs its website."

5. **Install the kit (3:50, 30 s).** In the terminal, from the repo root:

       bun run --filter @keryx-kit/demo-coffee install-kit

   It takes the newest kit in ~/Downloads, prints the company slug, deploys and ends with a
   green checklist (`/`, `/join`, `root.json`, `1.root.json`) and "The kit is live".
   Say: "Two small JSON files and one static page. Any web host can serve them."

6. **Check now (4:20, 15 s).** Back in the console, Domain card → **Check now**. The badge turns
   **Live**.
   Say: "The domain is now the trust anchor. Phones check the shop's keys against it."

7. **Invite an author (4:35, 30 s).** Team → "Who is it for?" `Marta, roastery` → **Create invite
   link** → **Copy link**. Send it to the author device (chat, AirDrop, or paste).
   Say: "Marta writes the news. She gets her own key, and the owner never handles it."

8. **Register a passkey (5:05, 60 s).** On the author device open the link. "Join Kindlewood
   Coffee as an author" → name `Marta` → **Continue** → create the passkey, then confirm it once
   more. The screen shows "You are registered" and a key fingerprint.
   Say: "Her signing key was made on her device and locked with her passkey. The server stores
   it encrypted."

9. **Confirm the website (6:05, 20 s).** Still on the author device, the console asks "Is
   coffee.roguedave.codes your company's website?" → **Yes, coffee.roguedave.codes is ours**.
   Say: "Her console pins the shop's keys from the shop's own domain, just like a customer's
   phone will."

10. **Create the orders channel (6:25, 60 s).** Presenter: Channels → **New channel**. Display
    name `Order & delivery notices`, slug `orders`, paste the description, tick Marta → **Review
    and sign** → **Sign with Trezor**, confirm on the device. The channel shows *Waiting for an
    author*.
    Say: "Only the Trezor can decide who may post in a channel."

11. **Author takes the channel (7:25, 30 s).** Author device: reload the console. "1 signature is
    waiting for you" → **Sign now**, one passkey prompt. On the presenter laptop the channel turns
    **Live**.

12. **Create the roasts channel (7:55, 60 s).** Same as step 10 with `Fresh roasts`, slug `roasts`
    and its description. Only one change can be open at a time, which is why this waits for
    step 11. Leave it *Waiting for an author*; step 13 signs it too.
    Say: "Different channels, different authors if you want. Customers pick what they follow."

13. **Publish the stage post (8:55, 90 s).** Author device: reload the console so it sees the
    roasts signature, then Write. Channel *Order & delivery
    notices*, title, post id `new-payment-provider` (overwrite the prefilled slug), paste the
    body, upload the image, tags `payments, security`, language English. The preview on the
    right is what subscribers will see. **Sign and publish**, one passkey prompt that also signs
    the roasts channel.
    Say: "This is exactly the message phishers copy. Here it carries Kindlewood's signature."

14. **Join from the phone (10:25, 2 min).** On the projector open https://coffee.roguedave.codes/join.
    It now shows "Get this website's announcements in Keryx" and a QR code. Scan it with the
    phone (or tap the shop's "Get Kindlewood news in Keryx" button on the phone). Point at "it
    must show exactly https://coffee.roguedave.codes". Tap **Open in Keryx**, confirm the website
    in the app, keep both channels, subscribe. The payment notice is in the inbox, with its image.
    Say: "No email address, no account. The phone checked every signature back to this domain."

15. **Close (12:25, 30 s).** Show the explainer at https://keryx-kit.roguedave.codes/subscribers.
    Say: "If a message about Kindlewood payments isn't in this channel, it isn't from Kindlewood."

The other four posts in `posts/` can go out after the talk, in any order.

## Before the demo

- [ ] One invite code per sign-up: one for the stage run, one for each rehearsal.
- [ ] A company cannot be deleted from keryx-kit, so every sign-up needs a new slug and company
      name. Rehearse as `Kindlewood Coffee R1` / `kindlewood-coffee-r1`, then `R2` / `-r2`.
      The stage run uses `Kindlewood Coffee` / `kindlewood-coffee`; if that slug is already taken,
      pick the stage slug now and fix this page.
- [ ] Rehearse the whole script once, then reset the website:

          bun run --filter @keryx-kit/demo-coffee reset-kit

      It removes the root files and deploys the "coming soon" `/join`. Check that its last line is
      green. Run it once more right before going on stage.
- [ ] Phone: after a rehearsal, open the company in the Keryx app and tap **Remove company**. The
      next run reuses the same domain with a new master key. Adding Keryx to the home screen
      beforehand saves a step.
- [ ] Author device: each rehearsal needs a new invite and registration, since the author belongs
      to that rehearsal's company.
- [ ] Trezor: same Suite wallet as always, no passphrase. Suite paired with the browser, popups
      allowed for the console.
- [ ] `vercel whoami` works in the terminal (install-kit deploys with the vercel CLI).
- [ ] ~/Downloads: install-kit picks the newest `keryx-join-kit-*.zip` and refuses one whose slug
      has no "coffee" in it. To use another file, pass its absolute path:
      `bun run --filter @keryx-kit/demo-coffee install-kit ~/Downloads/keryx-join-kit-kindlewood-coffee.zip`.
      Relative paths resolve from `apps/demo-coffee`.
- [ ] Have the stage post open in an editor for copy and paste, and the logo and post image easy
      to find in the file picker.
- [ ] If the venue Wi-Fi is bad, put the laptop and phone on a phone hotspot. install-kit takes
      about 10 seconds on a good line.

## If something goes red

- install-kit shows red lines: it retries for 30 seconds before printing them. Read the line,
  fix it, run install-kit again. A wrong kit (another company) shows up as the company slug in
  its header.
- Check now says *Mismatch*: the reason names the file. Usually the kit on the site is from an
  earlier rehearsal; download the kit again and rerun install-kit.
- "Another change is already open": the previous channel still waits for the author's signature.
  Do step 11 first.
