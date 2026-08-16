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
```

`WEB_ORIGIN` and `GOOGLE_CLIENT_ID` are plain `vars` in `wrangler.jsonc` — neither is a secret,
and `GOOGLE_CLIENT_ID` must match the one `web/.env.production` builds the frontend with, or
sign-in fails verification.

### Google sign-in

Sign-in is Google-only (see `CLAUDE.md`). This is the one piece of setup that still lives in
Google's world — Google Identity Services needs a real OAuth Web Client, but nothing else about
it (no billing account, no GCP services enabled):

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → OAuth consent
   screen** — External, add `sutamaya.org` as an authorized domain, publish.
2. **Credentials → Create Credentials → OAuth client ID → Web application** — authorized
   JavaScript origins: your local dev URL (`http://localhost:5173`), the custom domain
   (`https://sutamaya.org`), and any preview URL you deploy to (the `*.workers.dev` URL Cloudflare
   assigns the Worker). No redirect URI is needed.
3. Put the resulting Client ID in `VITE_GOOGLE_CLIENT_ID` in `web/.env.production` (and
   `web/.env.development` for local dev) — it's a public identifier, safe to commit — and in
   `GOOGLE_CLIENT_ID` under `vars` in `wrangler.jsonc`, which is what the Worker uses to verify a
   sign-in token was actually issued for this app.

## Deploy

```bash
npm run deploy
```

`npm run deploy` (root `scripts/deploy.sh`) runs `npm test`, refuses to continue if it fails
(`npm run deploy -- --skip-tests` overrides), then `npm run build` followed by `npx wrangler
deploy`. The build is not optional: `wrangler` uploads `web/dist` exactly as it finds it, so a
stale directory ships a stale SPA and a stale corpus bundle. There's no CI/deploy-on-push — every
deploy is this one command, run by hand.

Open the deployed URL, sign in with Google, and confirm lists/notes/highlights save and survive a
refresh — that round-trips through D1, so it's the real end-to-end check.

## Custom domain

`sutamaya.org` is wired up via `routes` in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "sutamaya.org", "custom_domain": true }]
```

Cloudflare creates and manages the apex DNS record and its TLS certificate — nothing to configure
at a DNS provider by hand, since Cloudflare already runs `sutamaya.org`'s nameservers. Takes
effect on the next `wrangler deploy`. Add the domain to the OAuth client's authorized JavaScript
origins too (see above) — `VITE_GOOGLE_CLIENT_ID` itself doesn't need to change.

## Rate limiting

Per-IP, via Cloudflare Rate Limiting bindings declared in `wrangler.jsonc` and applied in
`worker/src/index.js`. A binding's `simple.period` accepts only 10 or 60 seconds:

| Path | Limit |
|---|---|
| `/api/*` in general | 60/min |
| `POST /api/auth/google` | 5/min |
| `GET /api/auth/me` | 20/min |
| `/data/*` (corpus, dictionary, per-sutta text) | — none |

The sign-in and `/me` budgets comfortably clear normal use (one `/me` per page load or PWA
relaunch, and a sign-in that only fires on a real button press). `/data/*` has no limiter because
it needs none: those files come from the assets binding and never invoke the Worker.

## Free-tier limits worth knowing

- Workers: 100,000 requests/day, 10ms CPU per invocation, 3MB gzipped script, 50 subrequests.
  Static-asset requests are free, unlimited, and don't count against that daily budget.
- Static assets: 20,000 files per version, 25MiB per file. The current build is ~4,100 files /
  83MB — but `dictionary.json` alone is 19.7MiB, leaving only ~5MiB of headroom against the
  per-file ceiling. Worth watching if the dictionary ever grows.
- D1: 5,000,000 rows read/day, 100,000 rows written/day, 5GB storage.

At this app's traffic level none of these are close to their ceiling, and there's no egress cost
line item to watch either — static assets are served free from Cloudflare's edge regardless of
where a reader is.

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
through Vite's own proxy to the Worker on `:8787` unchanged. Add
`https://local.sutamaya.org` to the OAuth client's authorized JavaScript origins once (see above)
— additive, so `http://localhost:5173` and the production origin are unaffected. Then open
`https://local.sutamaya.org` on the phone (same LAN) — sign-in should complete normally.

## Notes / gaps

- No CI — deploys are manual.
