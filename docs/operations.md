# Operations

keryx-kit runs as one Docker image behind Caddy on a DigitalOcean droplet
(`138.68.88.79`, Ubuntu 24.04, 1 GB RAM + 2 GB swap).

| Hostname | Points to |
|---|---|
| `keryx-kit.roguedave.codes` | app:3000 (landing page) |
| `console.keryx-kit.roguedave.codes` | app:3000 (console and API) |
| `repo.keryx-kit.roguedave.codes` | app:3000 (repo bases) |

DNS A records live in the Vercel DNS zone for `roguedave.codes`. Caddy gets and
renews the Let's Encrypt certificates on its own.

## How a release works

Every push to `main` runs `.github/workflows/ci.yml`:

1. `check`: lint, typecheck, tests.
2. `release` (only on `main`, only if `check` passed, one at a time):
   1. Builds the `linux/amd64` image from `Dockerfile` and pushes
      `ghcr.io/kaladivo/keryx-kit:latest` and `:<commit sha>`. The digest is in
      the job summary.
   2. Copies `deploy/` to `/srv/keryx-kit` over SSH as the `deploy` user.
   3. Logs the droplet in to GHCR with the job's `GITHUB_TOKEN`, runs
      `/srv/keryx-kit/release.sh <sha>`, and logs out again.
   4. Polls `https://console.keryx-kit.roguedave.codes/healthz` for 3 minutes
      and fails the job if it never returns 200.

`release.sh <tag>` pulls the images, stops the app, writes a backup of `/data`,
records the tag in `/srv/keryx-kit/.env`, starts the stack, and prunes images
older than 7 days that no container uses. The app is down for a few seconds
while the backup runs; stopping it first keeps the SQLite copy consistent.

GitHub Actions secrets: `DEPLOY_SSH_KEY` (ed25519 key authorized only for
`deploy`, no forwarding, no pty), `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`.

## Where things live on the droplet

| Path | Contents | Owner |
|---|---|---|
| `/srv/keryx-kit/compose.yaml`, `Caddyfile`, `release.sh` | Copied from `deploy/` on every release | `deploy` |
| `/srv/keryx-kit/.env` | `KERYX_KIT_TAG=<sha>` of the running release | `deploy` |
| `/srv/keryx-kit/data/` | Mounted as `/data`: SQLite database and repo directory | `10001` (container user), 0750 |
| `/srv/keryx-kit/secrets/kek` | 32-byte KEK, mounted read-only at `/run/secrets/kek` (`KERYX_KEK_FILE`) | `root:10001`, 0440 |
| `/srv/keryx-kit/secrets/operator-token` | Operator login token (hex), mounted read-only at `/run/secrets/operator-token` (`KERYX_OPERATOR_TOKEN_FILE`) | `root:10001`, 0440 |
| `/srv/keryx-kit/backups/` | `data-<UTC timestamp>.tar.gz`, last 7 kept | `root`, 0700 |
| Docker volumes `keryx-kit_caddy-data`, `keryx-kit_caddy-config` | Caddy certificates and state | |

The KEK exists only on the droplet. It is not in git, GitHub or any backup. If it
is lost, the encrypted ops and channel keys in the database cannot be decrypted.

Other setup: Docker Engine and the compose plugin from Docker's apt repo,
`ufw` allowing 22/tcp, 80/tcp and 443 only, unattended-upgrades, SSH key-only
login (`/etc/ssh/sshd_config.d/00-hardening.conf`). Only Caddy publishes ports;
the app's port 3000 is reachable only on the compose network. Container logs use
the `local` driver, capped at 3 × 10 MB per container.

Memory limits: app 512 MB (768 MB with swap), Caddy 128 MB.

Inside `/data`:

| Path | Contents |
|---|---|
| `keryx-kit.db` (+ `-wal`, `-shm`) | SQLite: companies, members, sessions, ceremonies, drafts, audit log, sealed server keys |
| `repos/<slug>/base/` | The repo base served at `https://repo.keryx-kit.roguedave.codes/<slug>/` |
| `repos/<slug>/anchor/` | `root.json` and every `N.root.json`, for the join kit and the domain check |

The operator logs in at the console with the token: `sudo cat /srv/keryx-kit/secrets/operator-token`
on the droplet. To rotate it, write a new value to the file (same owner and mode); the
server reads it on every login.

## Server configuration

| Variable | Default | Meaning |
|---|---|---|
| `KERYX_SERVICE_HOST` | `keryx-kit.roguedave.codes` | Landing host; the console and repo hosts are `console.` and `repo.` under it |
| `KERYX_SCHEME` | `https` | Scheme for the console and repo origins |
| `KERYX_CONSOLE_ORIGIN` | `<scheme>://console.<host>` | Origin WebAuthn and invite links use (override for a console dev server) |
| `PORT` | `3000` | Listen port |
| `KERYX_DATA_DIR` | `/data` | SQLite file and repo directories |
| `KERYX_KEK_FILE` | `/run/secrets/kek` in the image | 32 raw bytes |
| `KERYX_OPERATOR_TOKEN_FILE` | `/run/secrets/operator-token` in the image | Operator token |
| `KERYX_SITE_DIR`, `KERYX_CONSOLE_DIR` | `apps/site/dist`, `apps/console/dist` | Static files |
| `KERYX_RELEASE_FILE` | `release.json` | Git SHA and console bundle hash, written at image build |

Scheduled jobs run in the server process: timestamp every 12 h, snapshot and channel
renewal and the domain check every 24 h, each also once at startup.

## Run locally

Port 3000 is often taken; use another one. With the console dev server proxying `/api`
to `http://console.localhost:3999` (`changeOrigin: true`):

```sh
mkdir -p tmp/dev && head -c 32 /dev/urandom > tmp/dev/kek && echo dev-token > tmp/dev/operator-token
bun run --filter @keryx-kit/site build
KERYX_DATA_DIR=tmp/dev KERYX_KEK_FILE=tmp/dev/kek KERYX_OPERATOR_TOKEN_FILE=tmp/dev/operator-token \
  KERYX_SERVICE_HOST=localhost:3999 KERYX_SCHEME=http KERYX_CONSOLE_ORIGIN=http://localhost:5173 \
  PORT=3999 bun apps/server/src/main.ts
```

The landing page is at `http://localhost:3999`, the repo bases at
`http://repo.localhost:3999/<slug>/`. Owner login keys are bound to the console origin, so a
Trezor identity made on localhost never works in production and the other way round.

## Roll back to a previous release

Find the SHA of a good commit (`git log`, or the image tags in GHCR), then:

```sh
ssh root@138.68.88.79 'sudo -u deploy /srv/keryx-kit/release.sh <sha>'
```

The droplet's GHCR login only exists during a release job. The pull works
without it if the package is public, or if the image is still cached on the
droplet (cached images are kept for 7 days). Otherwise, re-run the `release` job
of that commit's workflow run in GitHub Actions. That also moves `latest` back to
the old commit.

The next push to `main` deploys the new commit as usual.

A rollback does not undo database migrations. If a release changed the schema,
restore the backup taken before it (below) together with the rollback.

## Restore a backup

```sh
ssh root@138.68.88.79
cd /srv/keryx-kit
ls -1t backups/                                   # newest first
sudo -u deploy docker compose stop app
mv data "data.broken-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0750 -o 10001 -g 10001 data
tar -xzf backups/data-<timestamp>.tar.gz -C data
sudo -u deploy docker compose up -d
curl -fsS https://console.keryx-kit.roguedave.codes/healthz
```

Delete the `data.broken-*` directory once the restore is confirmed.

## Making the GHCR package public (optional)

Releases authenticate to GHCR, so the package can stay private. To let anyone
pull it (and make manual rollbacks work without a login), open
<https://github.com/users/kaladivo/packages/container/keryx-kit/settings> and set
visibility to public. GitHub has no REST endpoint for this.

## Not covered yet

- Off-site, encrypted backups (F3). Backups only exist on the droplet, so losing
  the droplet loses the data. The KEK needs its own off-site copy, kept apart
  from the database backups.
- A tested restore drill and backup monitoring.
- Uptime monitoring and alerting beyond the healthz check in the release job.

The console bundle hash (§5.9) is in each release job summary and at
`https://console.keryx-kit.roguedave.codes/api/release`.
