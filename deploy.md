# Deploying to Cloud Run

Sutamaya deploys as **one Cloud Run service**: the container built from the root `Dockerfile`
runs the Express API and also serves the built React SPA (`web/dist`) — see `CLAUDE.md` for why
(same-origin cookies, one thing to deploy). User data (lists/notes/highlights/visited) lives in
**Firestore**, not the SQLite file `server/src/db.js` used to use — Cloud Run's container
filesystem is ephemeral, and Firestore's Always Free tier is generous enough that a personal-use
deployment of this app shouldn't need to pay anything. See "Staying in the free tier" below for
the numbers.

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
export REGION=us-central1   # check the Cloud Run/Firestore pricing pages for current
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

## 5. Deploy

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
  --max-instances=2 \
  --memory=512Mi
```

This uploads the repo to Cloud Build, builds the image from `Dockerfile`, pushes it to Artifact
Registry, and deploys it. First run takes a few minutes (mostly the corpus-build + npm install
steps inside the build); later deploys are faster since layers are cached. `--allow-unauthenticated`
is what makes it reachable as a normal public web app — drop it if you want to gate access behind
IAM/IAP instead.

`GOOGLE_CLOUD_PROJECT` (which `server/src/firestore.js` uses to talk to the right Firestore
database) is set automatically by Cloud Run — you don't need to pass it.

`gcloud run deploy` prints the service URL when it finishes:

```bash
gcloud run services describe sutamaya --region="$REGION" --format='value(status.url)'
```

Open it, register an account, and confirm lists/notes/highlights save and survive a refresh —
that round-trips through Firestore, so it's the real end-to-end check.

## Redeploying

Same command as step 5, every time. Cloud Build rebuilds the image fresh from your current
working tree (uncommitted changes included, since `--source .` uploads the local directory, not
a git ref — commit first if you want the deployed image to match a specific commit).

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
  image (~500MB uncompressed, less as compressed layers, but they accumulate). Clean up old
  images periodically:
  ```bash
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy" \
    --format='value(IMAGE)' | tail -n +6 | xargs -I{} gcloud artifacts docker images delete {} --quiet
  ```
  (keeps the 5 most recent, deletes the rest — adjust as you like).
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

## Notes / gaps

- No custom domain wiring in this guide — `gcloud run domain-mappings create` if you want one.
- No CI — every deploy above is a manual `gcloud run deploy --source .`. Wire it into a GitHub
  Actions workflow with `google-github-actions/deploy-cloudrun` later if you want deploys on
  push.
- `--max-instances=2` is just a sane default for a personal app (bounds worst-case cost); raise
  it if you expect real concurrent traffic. Firestore itself has no concurrency caveat the way
  the old SQLite-on-a-mounted-volume approach would have — this is one of the reasons Firestore
  was worth migrating to instead.
