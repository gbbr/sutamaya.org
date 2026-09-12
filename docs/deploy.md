# Deploying

Production and staging are each one Cloudflare Worker, which serves the built app and corpus as
static assets and answers `/api/*` from its D1 database ([backend.md](backend.md)). A deploy is one
command, run by hand.

## Deploy

```
npm run deploy:prod        # production
npm run deploy:staging     # staging
```

Both run `scripts/deploy.sh`, which:

1. checks you're logged in to Cloudflare (`npx wrangler login`);
2. runs `npm test` and stops on a failure (`-- --skip-tests` skips it);
3. builds the corpus and the app into `web/dist`;
4. applies pending migrations to that environment's database;
5. uploads the Worker and `web/dist`;
6. says so if the native apps' over-the-air bundle is now behind ([native-apps.md](native-apps.md)).

A bare `npm run deploy` names no environment and refuses to run, so production is only ever reached
by asking for it. Nothing deploys on push. The end-to-end suite isn't part of a deploy either —
check its last CI run on `main` first.

Afterwards, open the site, sign in, and check that a list, note or highlight survives a refresh:
that round-trips through D1.

### Migrations only add

Migrations run just before the upload, so for a moment the previous Worker serves against the new
schema. A migration therefore only adds — a table, an index, a column with a default — and never
renames or drops. A destructive change takes two deploys: widen the schema and ship code that
handles both shapes, then narrow it once nothing reads the old one.

## Staging

A full second copy on `staging.sutamaya.org` and `app.staging.sutamaya.org`, with its own
database, secrets and sessions, for trying a change end to end — sign-in included — before readers
see it.

- **It runs production's build.** The Worker rewrites what differs on the way out, decided by
  hostname: staging's icons and installed name, the landing page's links into the app, and a
  `noindex` header. The Library shows the build's commit at its foot, with a `*` when the build
  came from uncommitted changes.
- **`npm run seed:staging`** replaces staging's database with a copy of your local one, so signing
  in there finds real data. It can only touch staging.
- **`npm run build:native -- --env staging`** builds a native app that calls staging
  ([native-apps.md](native-apps.md)).
- **`wrangler.jsonc`** declares staging as `env.staging` and repeats only what differs — name,
  hostnames, database, update bucket, rate-limit namespaces and variables — so its routing is
  production's.

The staging icons, and the dev server's, are generated from the production icons with
`node scripts/make-brand-icons.mjs`.

## One-time setup

Done already for both environments; this is what a new one needs.

```
npx wrangler login
npx wrangler d1 create <name>            # its database_id goes in wrangler.jsonc
npx wrangler r2 bucket create <name>     # the native apps' update bundles
npx wrangler secret put SESSION_SECRET   # any long random string
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
```

Add `--env staging` for staging. `WEB_ORIGIN`, `GOOGLE_CLIENT_ID` and `MAIL_FROM` are plain
variables in `wrangler.jsonc`, not secrets.

**Google sign-in** needs an OAuth "Web application" client in Google Cloud Console, and a consent
screen listing `sutamaya.org`. Its authorized redirect URIs are `/api/auth/google/callback` on every
app origin that signs in — production, staging, `http://localhost:5173` and
`https://app.local.sutamaya.org` — always the app's hostname, never the landing page's, and matching
exactly. Staging shares production's client.

**Email sign-in** sends through [Resend](https://resend.com), whose free tier is plenty. Verify
`sutamaya.org` there (its SPF, DKIM and DMARC records keep codes out of spam) and create a send-only
API key. `MAIL_FROM` has to be on the verified domain.

**Hostnames** are custom domains on the Worker (`routes` in `wrangler.jsonc`); Cloudflare creates
their DNS records and certificates on the next deploy.

## Free-tier limits

The app is built to stay within Cloudflare's free tier:

- **Workers:** 100,000 requests a day, 10 ms of CPU and 50 subrequests per request. Static files
  count toward none of these — and the subrequest budget is why a sync push carries at most 10 items.
- **Static assets:** 20,000 files per version, 25 MiB each. A build is about 4,200 files, the
  largest (a search file) about 10 MB.
- **D1:** 5 million rows read and 100,000 written a day, 5 GB stored.

Static files are served from Cloudflare's edge at no cost, wherever the reader is.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`: the type check and unit tests
in one job, the end-to-end suite in another ([e2e.md](e2e.md)). It never deploys.
