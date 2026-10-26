# Kindlewood Coffee demo site

Kindlewood Coffee is a fictional roastery for the keryx-kit onboarding demo. This app is its
website, served at https://coffee.roguedave.codes, and the place where its Keryx join kit goes
during the demo. The stage script is in [DEMO.md](DEMO.md).

- `index.html`, `src/`: the homepage. Static, no scripts, no third-party requests. The artwork in
  `src/assets/` is hand-made SVG.
- `src/join-coming-soon.html`: what `/join` serves while no kit is installed.
- `vercel.json`: the headers and rewrites the join kit needs.
- `posts/`: posts for the Fresh roasts and Order & delivery notices channels. See
  `posts/README.md`.
- `brand/kindlewood-logo-512.png`: the logo for the console's sign-up form.
- `scripts/`: `install-kit`, `reset-kit` and `deploy`.

## Commands

From the repo root:

    bun run --filter @keryx-kit/demo-coffee dev                  # local dev server
    bun run --filter @keryx-kit/demo-coffee install-kit [zip]    # install a kit, deploy, check
    bun run --filter @keryx-kit/demo-coffee reset-kit            # remove the kit, deploy, check
    bun run --filter @keryx-kit/demo-coffee deploy               # deploy what public/ holds, check

All three deploy commands build with Vite and run `vercel deploy dist --prod` to the Vercel
project `keryx-demo-coffee`, with `vercel.json` as its config. Nothing is built on Vercel. You
need the `vercel` CLI, logged in to the account that owns the project. Each command then fetches
the live site and prints one green or red line per check, retrying for up to 30 seconds while
the domain switches to the new deployment. It exits non-zero if any line stays red.

## The join kit

The console's owner dashboard downloads `keryx-join-kit-<slug>.zip`:

| File in the zip | Goes to | Served at |
|---|---|---|
| `.well-known/keryx/root.json` | `public/.well-known/keryx/` | `/.well-known/keryx/root.json` |
| `.well-known/keryx/N.root.json` (one per root version) | `public/.well-known/keryx/` | `/.well-known/keryx/N.root.json` |
| `join/index.html` | `public/join/index.html` | `/join` and `/join/` |
| `README.md` | nowhere | not served |

`install-kit` takes the zip path as its argument, or the newest `keryx-join-kit-*.zip` in
~/Downloads. Without an argument it refuses a kit whose company slug has no "coffee" in it, so
Scuffwell's kit cannot land here by accident. Pass an absolute path: `bun run --filter` runs the
script from `apps/demo-coffee`. It replaces any root files from an earlier kit, deploys, and
checks:

- `/` answers 200.
- Every root file answers 200 with `Content-Type: application/json`,
  `Access-Control-Allow-Origin: *` and the same bytes as the zip.
- `/join` answers 200 with `Referrer-Policy: no-referrer` and the same bytes as the zip's
  `join/index.html`.

`reset-kit` deletes `public/.well-known/keryx/`, puts the coming-soon page back at
`public/join/index.html`, deploys, and checks that `root.json` answers 404 and `/join` serves
the coming-soon page.

The kit files are not committed (see `.gitignore`): every rehearsal changes them. On a fresh
checkout `deploy` starts from the coming-soon page.

## What `vercel.json` does

- `/.well-known/keryx/*`: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`
  and `Cache-Control: no-cache`.
- `/join`, `/join/` and `/join/index.html` all serve `join/index.html` with status 200 and no
  redirect, with `Referrer-Policy: no-referrer` and `Cache-Control: no-cache`.
- Every response gets `Strict-Transport-Security`. Vercel redirects plain HTTP to HTTPS (308).
- Hashed files under `/assets/` are cached for a year.

The kit README also asks to keep the `p` query parameter of `/join` out of access logs. Vercel
keeps request logs for a short time only and this project has no log drain, so there is
nothing to configure. Don't add a log drain or analytics to this project.
