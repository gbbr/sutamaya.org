# Deploying

Sutamaya deploys as **one Cloudflare Worker** — it serves the built React SPA and the static
corpus from Cloudflare's edge (via the Worker's assets binding) and handles `/api/*` itself,
backed by **D1** (serverless SQLite) for user data.

## One-time setup

```bash
npx wrangler login
npx wrangler d1 create sutamaya            # copy the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply sutamaya --remote
npx wrangler secret put SESSION_SECRET     # any long random string
npx wrangler secret put GOOGLE_CLIENT_SECRET   # from the OAuth client below
```

`WEB_ORIGIN` and `GOOGLE_CLIENT_ID` are plain `vars` in `wrangler.jsonc` — neither is a secret.
`WEB_ORIGIN` carries more weight than it looks: the OAuth flow builds every URL in the round trip
from it (the redirect URI it registers with Google, and the address it sends the browser back to),
so a wrong value doesn't degrade sign-in, it breaks it.

### Google sign-in

The browser never talks to Google's JavaScript — it navigates to `/api/auth/google/start`, and the
Worker runs the OAuth 2.0 authorization-code exchange server-side (`worker/src/oauth.js`). So the
frontend build takes no auth configuration at all; both halves of the credential live on the
Worker. Setup needs a real OAuth Web Client, but nothing else from Google (no billing account, no
GCP services enabled):

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → OAuth consent
   screen** — External, add `sutamaya.org` as an authorized domain, publish.
2. **Credentials → Create Credentials → OAuth client ID → Web application** — set **authorized
   redirect URIs** (not JavaScript origins, which this flow doesn't use) to
   `/api/auth/google/callback` on every origin you sign in from:
   - `http://localhost:5173/api/auth/google/callback` — local dev
   - `https://app.local.sutamaya.org/api/auth/google/callback` — local dev over HTTPS, for testing
     on a phone (see "Testing on mobile" below)
   - `https://app.sutamaya.org/api/auth/google/callback` — production
   - the same path on any preview URL you deploy to

   Always the **app's** hostname, never the marketing site's: the app is the only thing that signs
   anyone in, and `WEB_ORIGIN` is what the flow builds this URI from.

   These must match byte for byte, or Google fails the round trip with `redirect_uri_mismatch`
   before the user ever gets back to the app.
3. Put the Client ID in `GOOGLE_CLIENT_ID` under `vars` in `wrangler.jsonc` (a public identifier,
   safe to commit), and the Client Secret in the `GOOGLE_CLIENT_SECRET` Worker secret above. For
   local dev both go in `.dev.vars`, along with `WEB_ORIGIN=http://localhost:5173` — the
   production `WEB_ORIGIN` in `wrangler.jsonc` would otherwise send the dev flow to the live site.

### Sign-in by emailed code

The second way in, and the one needing no provider account. Codes go out through
[Resend](https://resend.com), whose free tier (3,000/month) covers this app many times over.
Cloudflare's own Email Sending would avoid the third party but requires a Workers Paid plan.

1. Sign up at resend.com and add `sutamaya.org` under **Domains** — it gives you the SPF/DKIM/DMARC
   records to add to the zone. Verification is what stops the mail landing in spam, so don't skip
   it; sending is blocked until the domain verifies.
2. **API Keys → Create**, with send permission only.
3. `npx wrangler secret put RESEND_API_KEY` for production, and the same key in `.dev.vars` for
   local dev.

`MAIL_FROM` (`vars` in `wrangler.jsonc`) is the address codes come from and must be on the verified
domain. Leave `RESEND_API_KEY` blank to develop without the email flow — `/api/auth/email/request`
then answers 502 and Google sign-in is unaffected. There's no local mail sink: a key that works
sends real mail to real inboxes, so test with an address you own.

## Deploy

```bash
npm run deploy:prod
```

`npm run deploy:prod` (root `scripts/deploy.sh`) runs `npm test`, refuses to continue if it fails
(`npm run deploy:prod -- --skip-tests` overrides), then `npm run build`, then applies any pending D1
migrations, then `npx wrangler deploy`. The build is not optional: `wrangler` uploads `web/dist`
exactly as it finds it, so a stale directory ships a stale SPA and a stale corpus bundle. There's no
CI/deploy-on-push — every deploy is this one command, run by hand.

**The environment is always named.** Bare `npm run deploy` reaches the script with no `--env` and
stops there, so the only way to reach production is to ask for it by name — worth the extra word,
now that a second environment exists and the two commands differ by one.

The end-to-end suite (`npm run test:e2e`, see `docs/e2e.md`) is **not** part of this. It is worth
running before a deploy, by hand, but it does not gate one: a gate has to be trustworthy enough
that a red run always means a real problem, and it is not there yet. CI does run it on every push
to main, so in practice a regression is usually already visible on the commit you're about to
deploy — check it rather than assuming it.

Migrations run *before* the upload, which is what makes a **migration additive-only** — `ADD COLUMN`
with a default, or a new index, never a rename or a drop. For the window between the two steps the
previous Worker is still serving against the new schema, so anything it can't tolerate is an outage.
A destructive change needs two deploys: widen the schema and ship code tolerating both shapes, then
narrow it once nothing reads the old shape.

`0004_highlight_endpoints.sql` is the one exception, taken deliberately. It rebuilds `highlights`
rather than widening it, because the columns it replaces are `NOT NULL` with no default — a
new-shape insert that left them out would fail, so there is no both-shapes state to ship. For the
seconds between the migration and the upload the previous Worker reads highlight rows it doesn't
understand, and an un-updated tab left open renders highlights wrong until it reloads. That was
accepted rather than carrying dual-shape code through two deploys.

(Local dev is not covered by this — a new migration has to be applied to your own D1 by hand, see
`CLAUDE.md`.)

Open the deployed URL, sign in with Google, and confirm lists/notes/highlights save and survive a
refresh — that round-trips through D1, so it's the real end-to-end check.

## Staging

A second copy of the whole thing — `staging.sutamaya.org` and `app.staging.sutamaya.org`, its own
D1 database, its own secrets, its own sessions — for exercising a change end to end, sign-in
included, before it reaches readers.

```bash
npm run deploy:staging    # the same script, with --env staging
npm run seed:staging      # replace staging's database with a copy of the local one
```

It is declared as `env.staging` in `wrangler.jsonc`, which repeats only what differs: the name, the
hostnames, the D1 database, the rate-limit namespaces and `WEB_ORIGIN`. `main`, the assets
configuration and the compatibility date are inherited, so the asset routing staging exercises is
production's rather than a copy that can drift from it.

**The build is production's build.** Nothing is compiled differently; what differs is written by the
Worker on the way out, decided from the hostname (`worker/src/stagingBrand.js`):

- the icon set and the installed name, so a browser tab, a dock and a home screen all say which of
  the two they point at. The artwork lives in `web/public/icons/staging/` and is regenerated from
  the production icons with `node scripts/make-staging-icons.mjs`.
- the landing page's links into the app, which are absolute and would otherwise walk the reader
  straight back to production.
- `X-Robots-Tag: noindex` on every page, so the staging hostnames stay out of search results. A
  header rather than a `robots.txt` rule: a crawler told not to fetch the page can still list its
  URL, having never been allowed to read the page that says not to.

The commit the deployment is running is shown at the foot of the tree pane, with a trailing `*`
when the build was made over an uncommitted working tree.

**Seeding.** `npm run seed:staging` exports the local development database and writes it over
staging's, tables and all. Destructive on staging by design, and only on staging — the environment
is hardcoded in `scripts/seed-staging.sh`. Signing in to staging with the same Google account
lands on the copied row, which is the point: real lists, notes and highlights to read.

**One-time setup**, per environment and already done for this one:

```bash
npx wrangler d1 create sutamaya-staging                  # database_id goes into wrangler.jsonc
npx wrangler secret put SESSION_SECRET --env staging     # its own, so staging sessions aren't production's
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put RESEND_API_KEY --env staging
```

The OAuth client is production's, with `https://app.staging.sutamaya.org/api/auth/google/callback`
added to its authorized redirect URIs — a second client would need its own consent screen for no
gain. `MAIL_FROM` is production's too, the Resend domain being the same.

## Custom domains

Two hostnames, one Worker, wired up via `routes` in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "sutamaya.org", "custom_domain": true },
  { "pattern": "app.sutamaya.org", "custom_domain": true }
]
```

`sutamaya.org` is the marketing site and serves one page, the static landing page.
`app.sutamaya.org` is the app and the API, and is what `WEB_ORIGIN` points at.

**Why they are separate origins.** A web app manifest's scope cannot exclude a path. While the
landing page shared an origin with the app it therefore sat inside the installed app's scope, and
Chrome offered "Open in app" on it — which opened the landing page itself in the app window, a
page with no JavaScript and no way through to the app. Narrowing the scope was not an option
either, since the app's routes (`/browse`, `/read`, `/settings`, `/help`) are siblings of `/`
rather than sitting under a prefix. On its own hostname the landing page is simply outside the
app, and the service worker, the manifest and `/` all mean one thing each again.

Cloudflare creates and manages both DNS records and their TLS certificates — nothing to configure
at a DNS provider by hand, since Cloudflare already runs `sutamaya.org`'s nameservers. Takes
effect on the next `wrangler deploy`.

### Keeping the app off the marketing hostname

The assets binding backs both hostnames, so without something in the way `sutamaya.org/browse/dn`
would serve the app there too — signed out, since the session cookie belongs to the app's origin.
Worse, a service worker registering on the marketing hostname would precache the shell and serve
it at `/`, burying the landing page exactly as before.

The Worker handles it: `APP_PATHS` in `worker/src/index.js` lists the app's own paths, and asked
for one of them on a marketing hostname it answers `301` to the same path on the app. The list is
mirrored in `assets.run_worker_first` (`wrangler.jsonc`) — without an entry there the asset router
answers first and the Worker never sees the request, so **the two lists have to change together**.

`sw.js` and `manifest.webmanifest` are the load-bearing entries: an install needs both, and neither
resolves on the marketing hostname. The page paths (`/browse/*`,
`/read/*`, `/settings`, `/help`, `/index.html`) are there so an old link still arrives somewhere
useful, one redirect later. Everything else — the corpus, the hashed assets, the landing page's own
files — is untouched and never invokes the Worker.

This is deliberately not a Cloudflare Redirect Rule: the same behaviour in a dashboard would be
invisible to the test suite and impossible to diff.

## Rate limiting

Per-IP, via Cloudflare Rate Limiting bindings declared in `wrangler.jsonc` and applied in
`worker/src/index.js`. A binding's `simple.period` accepts only 10 or 60 seconds:

| Path | Limit |
|---|---|
| `/api/*` in general | 60/min |
| `/api/auth/*` except `/me` | 15/min |
| `GET /api/auth/me` | 20/min |
| `/data/*` (corpus, dictionary, per-sutta text) | — none |

The sign-in budget has to cover more than one request per attempt: a Google sign-in spends two
(start, callback) and an emailed-code sign-in at least two more (request, verify), plus a mistyped
code or a resend. Guessing a code is bounded by `login_codes.attempts`, not by this. The `/me`
budget clears normal use easily (one per page load or PWA relaunch). `/data/*` has no limiter
because it needs none: those files come from the assets binding and never invoke the Worker.

## Free-tier limits worth knowing

- Workers: 100,000 requests/day, 10ms CPU per invocation, 3MB gzipped script, 50 subrequests.
  Static-asset requests are free, unlimited, and don't count against that daily budget.
- Static assets: 20,000 files per version, 25MiB per file. The current build is ~4,200 files /
  87MB, and the largest single file is a ~1MB text shard — both ceilings are far off.
- D1: 5,000,000 rows read/day, 100,000 rows written/day, 5GB storage.

At this app's traffic level none of these are close to their ceiling, and there's no egress cost
line item to watch either — static assets are served free from Cloudflare's edge regardless of
where a reader is.

## Testing on mobile (local dev)

The dev server already listens on all interfaces (`host: true` in `web/vite.config.ts`) and a
phone on the same LAN can reach it by this machine's mDNS name (add it to `devHosts` in
`web/vite.config.ts` to allow it through the dev server's Host-header guard). That's enough for
browsing, but **Google sign-in won't work over it**: the flow's redirect URI has to be registered
on the OAuth client, and Google only accepts hosts on a real, public top-level domain (plus
`localhost` itself) — so neither a LAN IP nor a `.local` mDNS name will ever be accepted, no matter
what's serving it. Deploying just to test a login-gated feature isn't practical for day-to-day
iteration.

The fix used here: real subdomains of `sutamaya.org` pointed at this machine's LAN IP, served
locally by [Caddy](https://caddyserver.com) with genuine Let's Encrypt certificates obtained via a
DNS-01 challenge against Cloudflare (sutamaya.org's DNS provider). DNS-01 only needs the ability
to create a TXT record — the machine doesn't need to be reachable from the public internet — so
this stays LAN-only the whole time. Caddy is a local reverse proxy in front of Vite, running only
when you start it.

**There are two of them, mirroring the two production hostnames**: `local.sutamaya.org` is the
marketing site and `app.local.sutamaya.org` is the app. The split is the whole mechanism that
keeps the landing page out of the installed app's scope, so a single local hostname could not
reproduce — or catch a regression in — the thing it exists to fix. Both point at the same Vite
server on `:5173`, which decides which one it is playing from the Host header, the same way the
Worker does (see `MARKETING_HOSTS` in `worker/src/index.js` and the `serve-landing-at-root` plugin
in `web/vite.config.ts`). Plain `localhost:5173` is the app, so day-to-day development needs none
of this; the landing page is reachable on any host at `/landing.html`.

**One-time setup:**

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit zone DNS" template,
   scoped to the `sutamaya.org` zone only. Save the token somewhere local (not in the repo).
2. Cloudflare dashboard → DNS → add two **A records**, `local` and `app.local`, both → this
   machine's current LAN IP (e.g. `192.168.1.50`), proxy status **DNS only** (grey cloud — a
   proxied/orange-cloud record would route through Cloudflare's edge, which can't reach a private
   IP). A DHCP reservation for this machine on your router keeps that IP from changing later;
   otherwise update the records if it does.
3. Standard `brew install caddy` does **not** include DNS provider plugins — download a build
   with the Cloudflare module from
   [caddyserver.com/download](https://caddyserver.com/download?package=github.com%2Fcaddy-dns%2Fcloudflare)
   (select `github.com/caddy-dns/cloudflare`), or build one with `xcaddy build --with
   github.com/caddy-dns/cloudflare`.
4. Create a `Caddyfile` **outside the repo** (it's machine-specific, not shared config —
   e.g. `~/caddy/sutamaya-local/Caddyfile`):
   ```
   local.sutamaya.org, app.local.sutamaya.org {
       reverse_proxy localhost:5173
       tls {
           dns cloudflare {env.CLOUDFLARE_API_TOKEN}
       }
   }
   ```
   One block for both names: they proxy to the same Vite server, which tells them apart by the
   Host header Caddy passes through.

**Each time you want to test on mobile:** with `npm run dev` running (Vite on `:5173`), start
Caddy from that directory —
```bash
CLOUDFLARE_API_TOKEN=your-token sudo --preserve-env=CLOUDFLARE_API_TOKEN caddy run
```
(`sudo` is needed to bind port 443; `--preserve-env` carries the token through). Caddy requests
the cert on first run and renews automatically on later runs — no local CA, no cert warnings, no
per-device trust step, since it's a real publicly-trusted certificate. `/api/*` keeps going
through Vite's own proxy to the Worker on `:8787` unchanged. Add
`https://app.local.sutamaya.org/api/auth/google/callback` to the OAuth client's authorized redirect
URIs once (see above) — additive, so `http://localhost:5173/...` and the production one are
unaffected. Only the app hostname needs one; nobody signs in from the marketing site. `.dev.vars`
lists both app origins in `WEB_ORIGIN` (`http://localhost:5173,https://app.local.sutamaya.org`),
and the flow picks whichever one the sign-in started on, so nothing needs editing per session and
a desktop browser on `localhost` keeps working at the same time. Then open
`https://app.local.sutamaya.org` on the phone (same LAN) — sign-in should complete normally, and
`https://local.sutamaya.org` shows the landing page beside it.

**To test PWA install/standalone behavior** over `app.local.sutamaya.org` (rather than just sign-in),
start Vite with `PWA_DEV=1 npm run dev` first — `vite-plugin-pwa` registers a service worker only
under `devOptions.enabled`, which is off by default (a dev-mode SW can serve stale responses and
fight Vite's HMR), so without it Chrome's "Add to Home Screen" falls back to a bookmark-style
shortcut that keeps showing the address bar instead of a true standalone app. Unregister the SW in
DevTools → Application afterward so it doesn't linger into a later plain `npm run dev` session.
