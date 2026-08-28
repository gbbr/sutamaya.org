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
   - `https://sutamaya.org/api/auth/google/callback` — production
   - the same path on any preview URL you deploy to

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
npm run deploy
```

`npm run deploy` (root `scripts/deploy.sh`) runs `npm test`, refuses to continue if it fails
(`npm run deploy -- --skip-tests` overrides), then `npm run build`, then applies any pending D1
migrations, then `npx wrangler deploy`. The build is not optional: `wrangler` uploads `web/dist`
exactly as it finds it, so a stale directory ships a stale SPA and a stale corpus bundle. There's no
CI/deploy-on-push — every deploy is this one command, run by hand.

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

(Local dev is not covered by this — a new migration has to be applied to your own D1 by hand, see
`CLAUDE.md`.)

Open the deployed URL, sign in with Google, and confirm lists/notes/highlights save and survive a
refresh — that round-trips through D1, so it's the real end-to-end check.

## Custom domain

`sutamaya.org` is wired up via `routes` in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "sutamaya.org", "custom_domain": true }]
```

Cloudflare creates and manages the apex DNS record and its TLS certificate — nothing to configure
at a DNS provider by hand, since Cloudflare already runs `sutamaya.org`'s nameservers. Takes
effect on the next `wrangler deploy`. Add the domain's `/api/auth/google/callback` to the OAuth
client's authorized redirect URIs too, and point `WEB_ORIGIN` at it (see above) — the client id and
secret themselves don't change.

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

The fix used here: a real subdomain of `sutamaya.org` — `local.sutamaya.org` — pointed at this
machine's LAN IP, served locally by [Caddy](https://caddyserver.com) with a genuine Let's
Encrypt certificate obtained via a DNS-01 challenge against Cloudflare (sutamaya.org's DNS
provider). DNS-01 only needs the ability to create a TXT record — the machine doesn't need to be
reachable from the public internet — so this stays LAN-only the whole time. Caddy is a local
reverse proxy in front of Vite, running only when you start it.

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
through Vite's own proxy to the Worker on `:8787` unchanged. Add
`https://local.sutamaya.org/api/auth/google/callback` to the OAuth client's authorized redirect
URIs once (see above) — additive, so `http://localhost:5173/...` and the production one are
unaffected. `.dev.vars` already lists both origins in `WEB_ORIGIN`, and the flow picks whichever
one the sign-in started on, so nothing needs editing per session and a desktop browser on
`localhost` keeps working at the same time. Then open `https://local.sutamaya.org` on the phone
(same LAN) — sign-in should complete normally.

**To test PWA install/standalone behavior** over `local.sutamaya.org` (rather than just sign-in),
start Vite with `PWA_DEV=1 npm run dev` first — `vite-plugin-pwa` registers a service worker only
under `devOptions.enabled`, which is off by default (a dev-mode SW can serve stale responses and
fight Vite's HMR), so without it Chrome's "Add to Home Screen" falls back to a bookmark-style
shortcut that keeps showing the address bar instead of a true standalone app. Unregister the SW in
DevTools → Application afterward so it doesn't linger into a later plain `npm run dev` session.
