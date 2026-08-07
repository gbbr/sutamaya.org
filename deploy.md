# Deploying to Cloud Run

Sutamaya deploys as **one Cloud Run service**: the container built from the root `Dockerfile`
runs the Express API and also serves the built React SPA (`web/dist`) — see `CLAUDE.md` for why
(same-origin cookies, one thing to deploy). User data (lists/notes/highlights/visited) lives in
**Firestore**, since Cloud Run's container filesystem is ephemeral — and Firestore's Always Free
tier is generous enough that a personal-use deployment of this app shouldn't need to pay
anything. See "Staying in the free tier" below for the numbers.

Once the one-time setup below is done, redeploying is just `npm run deploy`.

This whole guide uses the `gcloud` CLI — no console clicking. Run every command from the repo
root unless noted.

## Prerequisites

- `gcloud` CLI installed and authenticated: `gcloud auth login`
- A GCP project with billing enabled (Always Free still requires a billing account attached —
  you won't be charged as long as you stay under the free thresholds)
- Docker is **not** required locally — `gcloud run deploy --source .` builds the image with
  Cloud Build for you. (If you want to build/test the image locally first, see the note at the
  bottom.)

Pick your project and a region once, and reuse them in every command below:

```bash
export PROJECT_ID=your-project-id
export REGION=europe-west1  # check the Cloud Run/Firestore pricing pages for current
                             # Always-Free-eligible regions before picking a different one

gcloud config set project "$PROJECT_ID"
```

## 1. Enable the APIs you need

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Create the Firestore database

Native mode (not Datastore mode) — this is what `@google-cloud/firestore` in `server/src/`
expects. **The location is permanent once set**, so double-check the region:

```bash
gcloud firestore databases create --location="$REGION" --type=firestore-native
```

Skip this if the project already has a Firestore Native database (a project gets at most one
default database).

## 3. Create a dedicated service account for the Cloud Run service

Don't run this on the default compute service account — a scoped one is one command away and
keeps the deployed service's permissions to exactly what it needs (Firestore read/write, nothing
else):

```bash
gcloud iam service-accounts create sutamaya-run \
  --display-name="Sutamaya Cloud Run service"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:sutamaya-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

## 4. Put the session secret in Secret Manager

The server refuses to start in production with the placeholder dev secret (see
`server/src/index.js`), so this step isn't optional:

```bash
gcloud secrets create sutamaya-session-secret --replication-policy=automatic

openssl rand -base64 32 | gcloud secrets versions add sutamaya-session-secret --data-file=-

gcloud secrets add-iam-policy-binding sutamaya-session-secret \
  --member="serviceAccount:sutamaya-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Set up Google sign-in

Sign-in is Google-only (see CLAUDE.md), so both the frontend and the server need the same OAuth
Web Client ID:

1. Google Cloud Console → **APIs & Services → OAuth consent screen** — External, add
   `sutamaya.org` (or your domain) as an authorized domain, publish.
2. **Credentials → Create Credentials → OAuth client ID → Web application** — authorized
   JavaScript origins: your local dev URL (`http://localhost:5173`), your custom domain if any,
   and the Cloud Run service URL. No redirect URI is needed.
3. Put the resulting Client ID in `VITE_GOOGLE_CLIENT_ID` in `web/.env.production` (and
   `web/.env.development` for local dev) — it's a public identifier, safe to commit.
   `npm run deploy` reads it from `web/.env.production` automatically and passes it to the
   server, so it only needs to be set once here — not pasted in on every deploy.

## 6. Deploy

From the repo root (where `Dockerfile` lives):

```bash
gcloud run deploy sutamaya \
  --source . \
  --region="$REGION" \
  --service-account="sutamaya-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="SESSION_SECRET=sutamaya-session-secret:latest" \
  --set-env-vars="NODE_ENV=production" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --timeout=30
```

This uploads the repo to Cloud Build, builds the image from `Dockerfile`, pushes it to Artifact
Registry, and deploys it. First run takes a few minutes (mostly the corpus-build + npm install
steps inside the build); later deploys are faster since layers are cached. `--allow-unauthenticated`
is what makes it reachable as a normal public web app — drop it if you want to gate access behind
IAM/IAP instead. `--timeout=30` bounds worst-case GB-seconds if a request ever hangs (raise it if
you have a route that legitimately needs longer).

Once the one-time setup above is done, `npm run deploy` (root `scripts/deploy.sh`) wraps this
same command: it checks `gcloud auth list` for an active account and errors out (no auto-login)
if you're not authenticated, resolves `PROJECT_ID` from the env or `gcloud config get-value
project`, and defaults `REGION` to `europe-west1` — override either with `PROJECT_ID=... REGION=...
npm run deploy`. It also pre-creates the `cloud-run-source-deploy` Artifact Registry repo and
attaches `scripts/artifact-cleanup-policy.json` to it (keep the 5 most recent image versions,
delete anything older than 30 days) before deploying — see "Staying in the free tier" below.
Pre-creating the repo also means `gcloud run deploy` never hits its interactive "create this repo?"
prompt, which is otherwise unsafe to run from a non-interactive script.

`GOOGLE_CLOUD_PROJECT` (which `server/src/firestore.js` uses to talk to the right Firestore
database) is **not** set automatically by Cloud Run, despite an earlier version of this doc
claiming otherwise — `scripts/deploy.sh` passes it explicitly (`--set-env-vars`) alongside
`NODE_ENV`. Without it, `firestore.js` falls back to its local-dev default project id
(`sutamaya-local`) and every Firestore call fails with a "permission denied on resource project
sutamaya-local" error — which only actually surfaces once a request reaches Firestore (e.g. the
first successful sign-in), so it's easy to deploy, see the app *load* fine, and not notice.

`gcloud run deploy` prints the service URL when it finishes:

```bash
gcloud run services describe sutamaya --region="$REGION" --format='value(status.url)'
```

Open it, sign in with Google, and confirm lists/notes/highlights save and survive a refresh —
that round-trips through Firestore, so it's the real end-to-end check.

## Redeploying

`npm run deploy`, every time — no arguments needed. Cloud Build rebuilds the image fresh from
your current working tree (uncommitted changes included, since `--source .` uploads the local
directory, not a git ref — commit first if you want the deployed image to match a specific
commit).

`scripts/deploy.sh` runs `npm test` first and refuses to deploy if it fails. To deploy anyway
(e.g. a known-flaky test, or a deliberate hotfix), pass `--skip-tests`:
`npm run deploy -- --skip-tests`.

## Staying in the free tier

Numbers as of writing — re-check the Cloud Run, Firestore, Artifact Registry, and Cloud Build
pricing pages before relying on these, since Google does change free-tier terms:

| Service | Always Free allowance (per month unless noted) |
|---|---|
| Cloud Run | 2,000,000 requests · 360,000 GB-seconds memory · 180,000 vCPU-seconds · 1GB egress |
| Firestore | 1GiB stored · 50,000 reads/day · 20,000 writes/day · 20,000 deletes/day (daily, not monthly, and never expires) |
| Cloud Build | 120 build-minutes/day |
| Artifact Registry | 0.5GB image storage |
| Secret Manager | 6 active secret versions · 10,000 access operations/month |

For a personal/low-traffic deployment of this app, Cloud Run and Firestore usage won't be close
to their ceilings. The two things actually worth watching:

- **Artifact Registry's 0.5GB is the tightest limit** — each `gcloud run deploy` pushes a new
  image (~500MB uncompressed, less as compressed layers, but they accumulate). `npm run deploy`
  attaches a native cleanup policy (`scripts/artifact-cleanup-policy.json`) to the repo that keeps
  the 5 most recent image versions and deletes anything older than 30 days automatically, so this
  doesn't need a manual step. To apply/update it by hand instead:
  ```bash
  gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
    --project="$PROJECT_ID" --location="$REGION" --policy=scripts/artifact-cleanup-policy.json
  ```
- **Set a budget alert** as a safety net regardless — it won't stop spending, but it emails you
  before anything surprising shows up:
  ```bash
  gcloud billing budgets create \
    --billing-account="$(gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')" \
    --display-name="Sutamaya free-tier guard" \
    --budget-amount=1USD \
    --threshold-rule=percent=100
  ```

## Local Docker testing (optional)

You can build and run the exact same image locally against the Firestore emulator before
deploying:

```bash
# terminal 1 — emulator (needs a JRE; `brew install openjdk` if you don't have one)
npx firebase-tools emulators:start --only firestore --project sutamaya-local

# terminal 2 — build + run
docker build -t sutamaya-local .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \
  -e SESSION_SECRET=local-test-secret \
  -e FIRESTORE_EMULATOR_HOST=host.docker.internal:8081 \
  -e GOOGLE_CLOUD_PROJECT=sutamaya-local \
  sutamaya-local
```

One thing that'll trip you up here and *shouldn't* worry you: cookies are set `secure` in
production mode, so over plain `http://localhost:8080` (no real TLS) the browser/curl won't
persist the session cookie and you'll see `401`s. That's correct behavior, not a bug — Cloud Run
terminates real HTTPS and forwards an `X-Forwarded-Proto: https` header that `trust proxy` picks
up, so it works normally once actually deployed. To reproduce that locally with curl, add
`-H 'X-Forwarded-Proto: https'` to your requests.

## Testing on mobile (local dev)

The dev server already listens on all interfaces (`host: true` in `web/vite.config.ts`) and a
phone on the same LAN can reach it by this machine's mDNS name (`gbbr.local`, already in
`allowedHosts`). That's enough for browsing, but **Google sign-in won't work over it**: GSI
validates the page's origin client-side against the OAuth client's authorized origins, and
Google rejects that origin outright unless its host ends in a real, public top-level domain —
so neither a LAN IP nor a `.local` mDNS name will ever be accepted, no matter what's serving it.
Deploying just to test a login-gated feature isn't practical for day-to-day iteration.

The fix used here: a real subdomain of `sutamaya.org` — `local.sutamaya.org` — pointed at this
machine's LAN IP, served locally by [Caddy](https://caddyserver.com) with a genuine Let's
Encrypt certificate obtained via a DNS-01 challenge against Cloudflare (sutamaya.org's DNS
provider). DNS-01 only needs the ability to create a TXT record — the machine doesn't need to be
reachable from the public internet — so this stays LAN-only the whole time, and nothing (no
VPN, no tunnel, no relay) sits in front of your other traffic; Caddy is just a local reverse
proxy in front of Vite, the same role nginx would play, only running when you start it.

**One-time setup:**

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit zone DNS" template,
   scoped to the `sutamaya.org` zone only. Save the token somewhere local (not in the repo).
2. Cloudflare dashboard → DNS → add an **A record**: `local` → this machine's current LAN IP
   (e.g. `192.168.1.50`), proxy status **DNS only** (grey cloud — a proxied/orange-cloud record
   would route through Cloudflare's edge, which can't reach a private IP). A DHCP reservation
   for this machine on your router keeps that IP from changing later; otherwise update the
   record if it does.
3. Standard `brew install caddy` does **not** include DNS provider plugins — download a build
   with the Cloudflare module from
   [caddyserver.com/download](https://caddyserver.com/download?package=github.com%2Fcaddy-dns%2Fcloudflare)
   (select `github.com/caddy-dns/cloudflare`), or build one with `xcaddy build --with
   github.com/caddy-dns/cloudflare`.
4. Create a `Caddyfile` **outside the repo** (it's machine-specific, not shared config —
   e.g. `~/caddy/sutamaya-local/Caddyfile`):
   ```
   local.sutamaya.org {
       reverse_proxy localhost:5173
       tls {
           dns cloudflare {env.CLOUDFLARE_API_TOKEN}
       }
   }
   ```

**Each time you want to test on mobile:** with `npm run dev` running (Vite on `:5173`), start
Caddy from that directory —
```bash
CLOUDFLARE_API_TOKEN=your-token sudo --preserve-env=CLOUDFLARE_API_TOKEN caddy run
```
(`sudo` is needed to bind port 443; `--preserve-env` carries the token through). Caddy requests
the cert on first run and renews automatically on later runs — no local CA, no cert warnings, no
per-device trust step, since it's a real publicly-trusted certificate. `/api/*` keeps going
through Vite's own proxy to the Express server on `:8787` unchanged. Add
`https://local.sutamaya.org` to the OAuth client's authorized JavaScript origins once (see step
5 above) — additive, so `http://localhost:5173` and the production origin are unaffected. Then
open `https://local.sutamaya.org` on the phone (same LAN) — sign-in should complete normally;
the dev session cookie is `secure: false` when `NODE_ENV` isn't `production`, so it isn't
affected by the "Local Docker testing" caveat above.

## Custom domain

```bash
gcloud beta run domain-mappings create --service=sutamaya --domain=your-domain.com --region="$REGION"
gcloud beta run domain-mappings describe --domain=your-domain.com --region="$REGION" \
  --format="yaml(status.resourceRecords)"
```

Add the printed A/AAAA records at your domain's DNS provider (root/apex, DNS-only — not
proxied, if using Cloudflare or similar, so Google can issue the TLS certificate). Certificate
provisioning is automatic once the records resolve, usually within an hour. Also add the domain
to the OAuth client's authorized JavaScript origins (see step 5) — `VITE_GOOGLE_CLIENT_ID`
itself doesn't need to change.

## Notes / gaps

- No CI — every deploy above is a manual `npm run deploy`. Wire it into a GitHub Actions
  workflow with `google-github-actions/deploy-cloudrun` later if you want deploys on push.
- `--max-instances=1` is a sane default for a personal app (bounds worst-case cost); raise it in
  `scripts/deploy.sh` if you expect real concurrent traffic.
