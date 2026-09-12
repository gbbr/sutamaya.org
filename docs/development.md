# Local development

Everything runs on your machine: the web app on Vite, the Worker under `wrangler dev` with a local
D1 database. No Cloudflare account is needed.

## Setup

Node 24.15 or later, then:

```
npm install
npm run dev
```

The app is on http://localhost:5173 and the Worker on port 8787, reached through Vite's `/api`
proxy. The local database lives under `.wrangler/` and is created on first run.

## Secrets

The Worker reads local secrets from `.dev.vars` in the repo root, which git ignores. Every one can
be left out: the app then runs signed out, which is a complete mode.

| Variable | For |
|---|---|
| `SESSION_SECRET` | any long random string; signs sessions and the sign-in state. The end-to-end tests need it too |
| `GOOGLE_CLIENT_SECRET` | Google sign-in; the client id is already in `wrangler.jsonc` |
| `WEB_ORIGIN` | `http://localhost:5173`, or a comma-separated list of origins to sign in from |
| `RESEND_API_KEY` | emailing sign-in codes; a working key sends real mail |

Set `WEB_ORIGIN`, or a Google sign-in ends on production, whose origin is the default. Google only
accepts the origins registered on the OAuth client — `localhost:5173` and `app.local.sutamaya.org` —
so anywhere else, sign in with an emailed code.

## Ports and a second copy

Both ports are strict: a taken one fails rather than drifting. To run a second copy alongside the
first, move both:

```
WEB_PORT=5180 WORKER_PORT=8790 npm run dev
```

`API_ORIGIN` points the web server's proxy at a Worker elsewhere. `npm run dev:web` and
`npm run dev:worker` run the two halves on their own.

## The local database

`npm run dev:worker` applies pending migrations before it starts. A migration added while the
Worker is running needs a restart, or `npm run migrate:local`. The unit tests apply every migration
to a fresh database of their own, so they pass even when the local one is behind.

## Testing on a phone

A phone on the same network can load the dev server at this machine's LAN address, but Google
won't accept a LAN address or a `.local` name as a sign-in redirect. For sign-in on a phone, two
real subdomains point at this machine, served over HTTPS by [Caddy](https://caddyserver.com):

- `local.sutamaya.org` stands in for the landing page, `sutamaya.org`;
- `app.local.sutamaya.org` stands in for the app, `app.sutamaya.org`.

Two, because the split between them is itself something to test
([backend.md](backend.md#two-hostnames)). Both reach the same Vite server, which tells them apart by
hostname. Plain `localhost` is the app, and the landing page is also at `/landing.html` on any host.

One-time setup:

1. In Cloudflare, create an API token from the "Edit zone DNS" template, scoped to `sutamaya.org`.
   Keep it out of the repo.
2. Add two DNS **A** records, `local` and `app.local`, pointing at this machine's LAN IP, set to
   **DNS only**. A DHCP reservation keeps the IP from changing.
3. Get a Caddy build with the Cloudflare DNS module
   ([caddyserver.com/download](https://caddyserver.com/download?package=github.com%2Fcaddy-dns%2Fcloudflare),
   or `xcaddy build --with github.com/caddy-dns/cloudflare`); Homebrew's lacks it.
4. Write a `Caddyfile` outside the repo:
   ```
   local.sutamaya.org, app.local.sutamaya.org {
       reverse_proxy localhost:5173
       tls {
           dns cloudflare {env.CLOUDFLARE_API_TOKEN}
       }
   }
   ```
5. Add `https://app.local.sutamaya.org/api/auth/google/callback` to the OAuth client's redirect
   URIs, and set `WEB_ORIGIN=http://localhost:5173,https://app.local.sutamaya.org` in `.dev.vars`.

Then, with `npm run dev` running, start Caddy from the Caddyfile's directory and open
`https://app.local.sutamaya.org` on the phone:

```
CLOUDFLARE_API_TOKEN=… sudo --preserve-env=CLOUDFLARE_API_TOKEN caddy run
```

The certificate is a real one, from Let's Encrypt through a DNS challenge, so the machine never has
to be reachable from outside and no device has to trust anything.

## Installing the dev app

The service worker is off in development, where it would fight hot reloading. To test installing
the app, start with `PWA_DEV=1 npm run dev`, and unregister the worker afterwards in DevTools →
Application so it doesn't linger.

## The native apps

`npm run dev:ios` and `npm run dev:android` run the app on a simulator, emulator or device, with
live reload. See [native-apps.md](native-apps.md).

## Odds and ends

- `window.__dangerWipeLocal()`, typed in the browser console, signs out, clears everything the app
  stored on this device, and reloads as a first visit. Unsynced work is lost; the account on the
  server is untouched.
- The dev server's icons are green and staging's blue, so a tab or a home screen says which one it
  points at. `node scripts/make-brand-icons.mjs` regenerates both from the production icons.
