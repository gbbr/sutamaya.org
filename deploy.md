# Deploying

Sutamaya has two deployments right now, and they are not the same thing:

- **`sutamaya.org` is served by Cloud Run** — the container built from the root `Dockerfile`,
  running the Express API and serving the built React SPA (`web/dist`), with user data in
  **Firestore**. Everything from "Cloud Run" below describes it. Nothing deploys to it any more;
  `npm run deploy` no longer targets it.
- **`npm run deploy` deploys the Cloudflare Worker** — one Worker serving the SPA and the static
  corpus from Cloudflare's edge plus `/api/*`, backed by **D1**. It is live on its `*.workers.dev`
  URL only, and takes over the custom domain at cutover.

## Deploying the Cloudflare Worker

`npm run deploy` (root `scripts/deploy.sh`) runs `npm test`, refuses to continue if it fails
(`npm run deploy -- --skip-tests` overrides), then `npm run build` followed by `npx wrangler
deploy`. The build is not optional: `wrangler` uploads `web/dist` exactly as it finds it, so a
stale directory ships a stale SPA and a stale corpus bundle.

One-time setup:

```bash
npx wrangler login
npx wrangler d1 create sutamaya          # database_id goes in wrangler.jsonc
npx wrangler d1 migrations apply sutamaya --remote
npx wrangler secret put SESSION_SECRET   # any long random string
```

`WEB_ORIGIN` and `GOOGLE_CLIENT_ID` are plain `vars` in `wrangler.jsonc` — neither is a secret,
and `GOOGLE_CLIENT_ID` must match the one `web/.env.production` builds the frontend with, or
sign-in fails verification. Each deployed origin (including the `*.workers.dev` preview URL) also
has to be listed in the OAuth client's *Authorized JavaScript origins*, or Google Identity
Services refuses to render the sign-in button there at all.

### Rate limiting

Per-IP, via Cloudflare Rate Limiting bindings declared in `wrangler.jsonc` and applied in
`worker/src/index.js`. A binding's `simple.period` accepts only 10 or 60 seconds, so the Express
app's 15-minute windows can't be carried over as-is — these are the per-minute conversions:

| Path | Express (per 15 min) | Worker (per min) |
|---|---|---|
| `/api/*` in general | 300 | 60 |
| `POST /api/auth/google` | 20 | 5 |
| `GET /api/auth/me` | 120 | 20 |
| `/data/*` (corpus, dictionary, per-sutta text) | 400 | — none |

Per-minute is *tighter* on a burst and looser over an hour; the sign-in and `/me` budgets are the
ones where that matters, and both still comfortably clear normal use (one `/me` per page load or
PWA relaunch, and a sign-in that only fires on a real button press). `/data/*` has no limiter
because it needs none: those files come from the assets binding and never invoke the Worker.

### Free-tier limits worth knowing

- Workers: 100,000 requests/day, 10ms CPU per invocation, 3MB gzipped script, 50 subrequests.
  Static-asset requests are free, unlimited, and don't count against that daily budget.
- Static assets: 20,000 files per version, 25MiB per file. The current build is ~4,100 files /
  83MB — but `dictionary.json` alone is 19.7MiB, leaving only ~5MiB of headroom against the
  per-file ceiling. Worth watching if the dictionary ever grows.
- D1: 5,000,000 rows read/day, 100,000 rows written/day, 5GB storage.

---

# Cloud Run

What follows describes the deployment `sutamaya.org` still points at. It uses the `gcloud` CLI —
no console clicking. Run every command from the repo root unless noted.

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
   `web/.env.development` for local dev) — it's a public identifier, safe to commit. The
   `gcloud run deploy` command below passes the same value to the server as `GOOGLE_CLIENT_ID`,
   which is what verifies a sign-in token was actually issued for this app. (The Worker gets it
   from `wrangler.jsonc`'s `vars` instead.)

## 6. Deploy

From the repo root (where `Dockerfile` lives):

```bash
gcloud run deploy sutamaya \
  --source . \
  --region="$REGION" \
  --service-account="sutamaya-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="SESSION_SECRET=sutamaya-session-secret:latest" \
  --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},WEB_ORIGIN=https://your-domain.com" \
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
you have a route that legitimately needs longer). `GOOGLE_CLOUD_PROJECT` and `WEB_ORIGIN` matter
here too — see the note right after this command.

This is the whole deploy — run it by hand. `npm run deploy` targets Cloudflare now, so there is
no script wrapping this command any more; the Artifact Registry repo and its cleanup policy
(`scripts/artifact-cleanup-policy.json`, "Staying in the free tier" below) already exist from
earlier deploys, and pre-creating the repo is what kept `gcloud run deploy` from hitting its
interactive "create this repo?" prompt. `--source .` also stages a source zip in Cloud Storage
that Cloud Build has no further use for once the image is built; the `run-sources-*` bucket's
7-day lifecycle rule cleans it up.

`GOOGLE_CLOUD_PROJECT` (which `server/src/firestore.js` uses to talk to the right Firestore
database) is **not** set automatically by Cloud Run, despite an earlier version of this doc
claiming otherwise — the `--set-env-vars` above passes it explicitly, alongside
`NODE_ENV`. Without it, `firestore.js` falls back to its local-dev default project id
(`sutamaya-local`) and every Firestore call fails with a "permission denied on resource project
sutamaya-local" error — which only actually surfaces once a request reaches Firestore (e.g. the
first successful sign-in), so it's easy to deploy, see the app *load* fine, and not notice.
`WEB_ORIGIN` (`https://sutamaya.org` here) is what `server/src/index.js` uses for the CORS
`origin` check — harmless to get wrong for the normal same-origin SPA+API deploy this guide
describes, but worth setting correctly if anything ever calls the API cross-origin.

`gcloud run deploy` prints the service URL when it finishes:

```bash
gcloud run services describe sutamaya --region="$REGION" --format='value(status.url)'
```

Open it, sign in with Google, and confirm lists/notes/highlights save and survive a refresh —
that round-trips through Firestore, so it's the real end-to-end check.

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
to their ceilings. Everything below is the full record of what's actually been done on this
project to keep it that way — the checklist to redo if this is ever set up again from scratch.

### Cost-reduction measures already in place

1. **Cloud Run scaling/CPU config** — part of the `gcloud run deploy` call in step 6 above, not a
   separate step:
   - `--min-instances=0` — scale to zero; nothing billed while nobody's using the app.
   - `--max-instances=1` — hard ceiling on concurrent instances, so a traffic spike or a bug that
     loops requests can't multiply cost unbounded.
   - No `--cpu-boost`/always-allocated-CPU flag — CPU is billed request-based (only while actually
     handling a request), the cheaper of Cloud Run's two CPU billing modes, instead of for the
     full lifetime of an instance.
   - `--memory=512Mi` — modest allocation; GB-seconds billing scales directly with this.
   - `--timeout=30` — bounds worst-case GB-seconds if a request ever hangs instead of returning.

2. **Artifact Registry's 0.5GB is the tightest free-tier limit** — each `gcloud run deploy` pushes
   a new image (~500MB uncompressed, less as compressed layers, but they accumulate). The repo
   carries a native cleanup policy (`scripts/artifact-cleanup-policy.json`) keeping only the 3 most
   recent image versions and deleting everything else immediately. To apply or update it:
   ```bash
   gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
     --project="$PROJECT_ID" --location="$REGION" --policy=scripts/artifact-cleanup-policy.json
   ```

3. **The `run-sources-$PROJECT_ID-$REGION` Cloud Storage bucket** — created automatically the
   first time `gcloud run deploy --source .` runs, one zip per deploy (source doesn't stay in Cloud
   Build; the zip is uploaded here first and Cloud Build reads it from here). This bucket doesn't
   benefit from Cloud Storage's Always Free tier at all outside a handful of US regions, so
   `europe-west1` (this doc's default) pays standard per-GB storage from the first byte — this was
   the actual cost driver found on this project (frequent deploys, nothing ever cleaning the
   bucket up: 57 leftover zips / ~1.1GB by the time it was noticed, deleted by hand once via
   `gcloud storage rm -r "gs://run-sources-${PROJECT_ID}-${REGION}/services/**"`). A bucket
   lifecycle rule now expires anything left after 7 days — applied once by hand, after the bucket
   exists (i.e. after the first deploy):
   ```bash
   cat > /tmp/gcs-lifecycle.json <<'EOF'
   { "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 7 } } ] }
   EOF
   gcloud storage buckets update "gs://run-sources-${PROJECT_ID}-${REGION}" \
     --project="$PROJECT_ID" --lifecycle-file=/tmp/gcs-lifecycle.json
   ```

4. **Budget alert** — doesn't reduce cost by itself, but is the safety net that emails you as
   spend crosses a threshold instead of finding out on the next invoice. Live config on this
   project: $5/month, alerts at 50% and 100% of spend. Recreate with:
   ```bash
   gcloud billing budgets create \
     --billing-account="$(gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')" \
     --display-name="Billing Alerts \$5" \
     --budget-amount=5USD \
     --threshold-rule=percent=0.5 \
     --threshold-rule=percent=1.0
   ```

5. **BigQuery billing export** — see "Billing export to BigQuery" just below. Also not a cost
   reducer by itself; it's what makes it possible to actually diagnose *where* cost came from at
   SKU level, which is how item 3 above was found in the first place instead of guessed at.

6. **Cloud Logging retention trimmed to 7 days** (`_Default` bucket, default is 30) — see "Cloud
   Logging retention" below. Recorded here for completeness, but flagged honestly: this is
   hygiene, not a real cost saving — see that section for why.

7. **Standing-infrastructure audit** — confirmed no Compute Engine instances, Cloud SQL, or GKE
   clusters exist on this project (all three APIs disabled), so there's no idle-but-billing
   compute sitting around beyond Cloud Run itself. See "What's *not* worth doing here" below.

### Billing export to BigQuery (for actually diagnosing cost)

A budget alert tells you *that* spend crossed a threshold, not *what* caused it. For that, enable
the standard usage cost export to BigQuery — this is the only way to get SKU-level detail (which
service, which SKU, which day). There's no `gcloud`/`bq` command that flips the export on itself
(it's a billing-account-level link, console-only): Console → Billing → your billing account →
**Billing export** → **BigQuery export** → **Standard usage cost** → edit → pick the dataset
below → Save.

The dataset it exports into does need to exist first, and that part *is* scriptable:

```bash
bq mk --project_id="$PROJECT_ID" --location=EU --dataset \
  --description="Cloud Billing export (standard usage cost)" billing_export
```

(use a location that matches where you'd query from; `EU`/`US` are the common choices — it
doesn't need to match `$REGION`, and can't be changed later without recreating the dataset).

To confirm the console step actually linked correctly without re-opening the console: once
enabled, Google grants a system service account write access to the dataset, so its presence in
the dataset's IAM bindings is the tell —

```bash
bq show --format=prettyjson "$PROJECT_ID:billing_export" | grep billing-export-bigquery
```

— if that prints `billing-export-bigquery@system.gserviceaccount.com` as an `OWNER`, the export
is wired up. The first rows can take up to a day or so to appear after enabling
(`SELECT COUNT(*) FROM \`$PROJECT_ID.billing_export.gcp_billing_export_v1_*\`` — the table name
suffix is your billing account ID with dashes as underscores); after that it refreshes multiple
times a day. Once populated, a query like this breaks cost down by service:

```bash
bq query --project_id="$PROJECT_ID" --use_legacy_sql=false '
  SELECT service.description AS service, sku.description AS sku,
         SUM(cost) AS cost, currency
  FROM `'"$PROJECT_ID"'.billing_export.gcp_billing_export_v1_*`
  WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY service, sku, currency
  ORDER BY cost DESC'
```

**What the first real data showed (Aug 3–14, ~12 days after enabling):** net cost after credits was
~$0.19 total and trending down to ~$0/day by the last few days — confirming the `run-sources`
bucket cleanup above actually took effect, not just in theory. More usefully, it showed which
free-tier allowances are real for this project and which aren't: every CPU/memory-related Cloud
Run SKU (`Services CPU`, `Services Memory`, `Min Instance CPU/Memory`) appears in the export with
a cost *and* an equal offsetting credit, netting to exactly $0 — but **Cloud Run network egress
(`Data Transfer Out`) gets no credit at all**, and was the only nonzero line item across the whole
period (the numbers table above lists "1GB egress" as part of Cloud Run's Always Free allowance,
but that only actually applies to specific destinations — traffic out of `europe-west1` isn't
covered). At this app's traffic level that's still negligible (~$0.15–0.50/month pace, nowhere
near the $5 budget), so it's not worth optimizing — but it's the one thing that will always show
nonzero cost as real usage grows, worth knowing rather than being surprised by later.

### Cloud Logging retention

Cloud Run/Cloud Build write to the project's `_Default` log bucket, which defaults to 30 days'
retention. Shortening it doesn't save money on its own — the Cloud Logging free tier (50GiB
ingested/project/month) is governed by ingestion volume, not how long logs are kept within that
default window — but it's still reasonable hygiene to cap it if you don't need a month of
history:

```bash
gcloud logging buckets update _Default --project="$PROJECT_ID" --location=global --retention-days=7
```

### What's *not* worth doing here

Checked and ruled out during a full standing-infrastructure audit: no Compute Engine instances,
Cloud SQL, or GKE clusters exist in this project (all three APIs are disabled), so there's no
idle-but-billing infra to find. Cloud Run itself is already in its cheapest configuration for
this app — `--min-instances=0` (scale-to-zero, no idle cost) and no `--cpu-boost`/always-on CPU
flag (request-based CPU billing, not allocated-while-idle). There's nothing further to trim on
the compute side; the GCS/Artifact Registry accumulation above was the actual (and only) real
cost driver found.

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
phone on the same LAN can reach it by this machine's mDNS name (add it to `devHosts` in
`web/vite.config.ts` to allow it through the dev server's Host-header guard). That's enough for
browsing, but **Google sign-in won't work over it**: GSI
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

- No CI — deploys are manual, on both platforms.
- `--max-instances=1` is a sane default for a personal app (bounds worst-case cost); raise it in
  the `gcloud run deploy` command if you expect real concurrent traffic.
