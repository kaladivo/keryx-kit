# Scuffwell posts

Posts for the two Scuffwell channels, ready to paste into the keryx-kit console.

## Channels

Create these in the console (Owner → Channels) before publishing.

| Slug | Display name | Description |
|---|---|---|
| `news` | News | New shoes, sales, pop-ups and care tips from Scuffwell. About twice a month. |
| `security` | Security advisories | Deadpan bulletins about laces, soles and scams. We will never ask you for a password, seed or code. |

## Publishing a post

Each file has front matter followed by the Markdown body. In the post editor:

1. Channel: the `channel` value.
2. Title: the `title` value, without the quotes.
3. Post id: the `id` value. The editor prefills a slug from the title; overwrite it.
4. Body: everything below the closing `---`.
5. Preview image: upload the file named in `image` (relative to this folder). The editor embeds it
   as a JPEG, shrinking anything larger than 1200 px.
6. Tags: the `tags` values, comma separated.
7. Language: English.

The images are 1080 × 1080 because the subscriber app crops preview images to a square. Every
post is under 120 KB including its base64 image, far below the 1 MB limit.

## Order

Publish in this order, so the newest post of each channel sits on top in the app:

| # | Channel | Id | Title |
|---|---|---|---|
| 1 | news | `autumn-field` | Autumn Field is here: the Rambler in Moss and Rust |
| 2 | news | `how-to-clean-suede` | How to clean suede without ruining it |
| 3 | news | `puddle-season-sale` | Puddle season: 20% off every pair of boots |
| 4 | news | `karlin-pop-up` | Our first pop-up opens in Karlín, Prague |
| 5 | security | `shoe-2026-001` | SHOE-2026-001: Denial of service via tangled shoelaces |
| 6 | security | `shoe-2026-002` | SHOE-2026-002: Lace-in-the-middle attack |
| 7 | security | `shoe-2026-003` | SHOE-2026-003: Sole replay attack |
| 8 | security | `shoe-2026-004` | SHOE-2026-004: Phishing campaign selling fake Cloud Insoles |

For a short live demo, publish 1 to 3 and 5 to 7 beforehand, then publish `karlin-pop-up` and
`shoe-2026-004` on stage.
