# Kindlewood posts

Posts for the two Kindlewood Coffee channels, ready to paste into the keryx-kit console.

## Channels

Create these in the console (Owner → Channels → New channel) before publishing.

| Slug | Display name | Description |
|---|---|---|
| `roasts` | Fresh roasts | New coffees, seasonal blends and brewing tips from our Brno roastery. About twice a month. |
| `orders` | Order & delivery notices | Shipping delays, holiday hours and changes to how you pay. We will never ask for your card details, a password or a code. |

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

The images are 1080 × 1080 because the subscriber app crops preview images to a square. Each is
under 70 KB, so every post stays far below the 1 MB limit.

## Posts

| # | Channel | Id | Title |
|---|---|---|---|
| 1 | roasts | `guji-hambela` | New single origin: Guji Hambela from Ethiopia |
| 2 | roasts | `hearth-holiday-blend` | Hearth, our holiday blend, is back until 31 December |
| 3 | roasts | `v60-brew-guide` | Brewing guide: a better V60 in four steps |
| 4 | orders | `holiday-shipping` | Holiday week: orders from 23 December ship on 4 January |
| 5 | orders | `new-payment-provider` | New payment provider: we will never ask for your card in a message |

**Stage post: `new-payment-provider`** (`orders-2-new-payment-provider.md`). It is the message
phishers imitate most, and the one where a signed channel makes the point by itself. The
others can be published after the demo, or before it in a rehearsal company.
