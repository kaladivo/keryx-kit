# Scuffwell demo site

Scuffwell is a fictional shoe brand for the keryx-kit demo. This app is its website,
served at https://shoe.roguedave.codes, and the place where its Keryx join kit lives.

- `index.html`, `src/`: the homepage. Static, no scripts, no third-party requests.
- `public/join/index.html`: a "coming soon" page until the join kit replaces it.
- `vercel.json`: the headers and rewrites the join kit needs.
- `posts/`: the posts for the News and Security advisories channels. See `posts/README.md`.

## Commands

From the repo root:

    bun run --filter @keryx-kit/demo-shoe dev      # local dev server
    bun run --filter @keryx-kit/demo-shoe deploy   # build and deploy to production

`deploy` runs `vite build`, then `vercel deploy dist --prod` to the Vercel project
`keryx-demo-shoe` with `vercel.json` as its config. Nothing is built on Vercel. You need the
`vercel` CLI, logged in to the account that owns the project.

## Adding the join kit

The console's owner dashboard downloads `keryx-join-kit-<company>.zip`. It contains:

| File in the zip | Goes to | Served at |
|---|---|---|
| `.well-known/keryx/root.json` | `public/.well-known/keryx/root.json` | `/.well-known/keryx/root.json` |
| `.well-known/keryx/N.root.json` (one per root version) | `public/.well-known/keryx/` | `/.well-known/keryx/N.root.json` |
| `join/index.html` | `public/join/index.html` (replaces the placeholder) | `/join` and `/join/` |
| `README.md` | nowhere | not served |

From the repo root:

    unzip -o ~/Downloads/keryx-join-kit-*.zip '.well-known/keryx/*' 'join/index.html' -d apps/demo-shoe/public
    bun run --filter @keryx-kit/demo-shoe deploy

Then commit the new files, so a later deploy from a clean checkout keeps them. Repeat both
steps whenever the console asks you to upload the kit again, for example after a root
rotation: the files must match the current kit byte for byte.

The console's domain check turns *Live* once the deploy is done.

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

## Linking to the join page

The homepage links to plain `/join`, which lets a subscriber pick channels in the app. To
preselect channels, replace the link with a join URL from the console (Join link page), which
carries a `?p=` parameter.
