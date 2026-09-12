# Backend

`worker/` is a single Cloudflare Worker, written with [Hono](https://hono.dev). It answers the API,
serves the built app and corpus from the same origin, and keeps user data in D1, Cloudflare's
SQLite. It is built to stay within Cloudflare's free tier.

## What answers what

| Request | Answered by |
|---|---|
| `/api/*` | the Worker: the API |
| `/` | the Worker: the landing page or the app, by hostname |
| the app's pages and shell (`/browse/*`, `/read/*`, `/settings`, `/help`, `/sw.js`, …) | the Worker, which serves the built shell with [link previews](#link-previews) and keeps it off the marketing hostname |
| `/.well-known/*` | the Worker: link verification for the native apps |
| everything else | Cloudflare's static assets, without running the Worker: the corpus, scripts, fonts, images |

`assets.run_worker_first` in `wrangler.jsonc` decides which paths reach the Worker, so it has to
list the same app paths the Worker handles.

## Two hostnames

`sutamaya.org` is the marketing site: a static landing page with its privacy and terms pages.
`app.sutamaya.org` is the app and the API. One Worker serves both and tells them apart by hostname;
the app's paths requested on the marketing hostname redirect to the app.

They're separate because a web app's install scope can't exclude a path. On a shared origin the
landing page would sit inside the installed app, and browsers would offer to open it there.

Development mirrors the split on `local.sutamaya.org` and `app.local.sutamaya.org`
([development.md](development.md)), and staging on `staging.sutamaya.org` and
`app.staging.sutamaya.org` ([deploy.md](deploy.md)).

## The API

| Endpoint | Does |
|---|---|
| `GET /api/auth/me` | who is signed in (`{user: null}` for nobody) |
| `GET /api/auth/google/start`, `…/callback` | the Google sign-in round trip |
| `POST /api/auth/email/request`, `…/verify` | sign-in by emailed code |
| `POST /api/auth/logout` | end the session |
| `DELETE /api/auth/account` | delete the account and everything in it |
| `GET /api/data` | all of the reader's data, as one snapshot |
| `POST /api/data/push` | the only write: up to 10 queued changes, each answered on its own |
| `GET /api/data/export` | the snapshot, as a file |
| `POST /api/updates/check`, `GET /api/updates/bundle/…` | over-the-air updates ([native-apps.md](native-apps.md)) |
| `GET /api/health` | a liveness check that touches the database |

Errors are `{"error": …}`: a short code, except from the email sign-in endpoints, whose messages
the app shows as they are. No API response is cached, except the update bundle, whose name carries
its version. How the data endpoints are used is [offline-sync.md](offline-sync.md).

## Data model

| Table | Holds |
|---|---|
| `users` | one row per account |
| `identities` | the ways into an account: a Google account, an email address |
| `login_codes` | emailed codes not yet used, stored hashed |
| `lists` | lists and groups; a list's suttas are a JSON array in its row |
| `notes` | one note per sutta |
| `highlights` | one row per highlight: a span between two points in the text |
| `visited` | when each sutta was last opened |

Every query on the reader's data is scoped with `AND user_id = ?`. The tables are flat, and that
clause is the only thing keeping one account's rows from another's.

List membership and the automatic lists (Visited, Highlights, Notes) are derived when the data is
read, never stored. The app keeps its own copy of that logic, so it can derive the same view
offline.

Migrations live in `worker/migrations/`. A deploy applies them just before uploading the new
Worker, which is why they have to be additive ([deploy.md](deploy.md)). `npm run dev:worker`
applies them locally.

## Sign-in

Two ways in, both ending in the same kind of session:

- **Google.** The Worker runs the OAuth exchange itself, so the browser never loads Google's
  scripts. That is what keeps sign-in working under Safari's tracking prevention and in installed
  iOS apps.
- **An emailed code** — six digits, sent through Resend, good for ten minutes and five tries. A code
  rather than a link, because a link opens in the browser, not in the installed app.

Accounts are linked by verified email address, so both ways lead to the same account.

The session is a signed cookie that lasts 90 days. The native apps can't carry the Worker's cookie,
so they get a signed token instead, renewed as it's used, and CORS lets them call the API from
their own origins. Checking either kind of session reads nothing from the database.

`WEB_ORIGIN` names the app's origin, or a comma-separated list of them in development. The Google
flow builds its redirects from it, so a wrong value breaks sign-in outright.

## Deleting an account

`DELETE /api/auth/account` removes the account and everything under it in one go, with no grace
period. Other devices still hold sessions that verify, since checking a session reads no database,
so the data endpoints confirm the account exists and answer **410** when it doesn't. That tells a
device to wipe its copy rather than ask the reader to sign in again.

## Rate limits

Per IP address, with Cloudflare's rate-limiting bindings:

| Path | Limit |
|---|---|
| all of `/api/*` | 60 a minute |
| `/api/auth/*`, except `/me` | 15 a minute, on top |
| `GET /api/auth/me` | 20 a minute, on top |

The sign-in budget leaves room for a mistyped code or a resend; guessing a code is stopped by its
five tries. Static files have no limit, since they never reach the Worker.

## Link previews

A shared link to a sutta or a library group gets its own title, description and preview image,
written into the page as it's served, because link-preview crawlers don't run the app. The Worker
looks them up in the corpus with its own copy of the app's lookups — change one, change the other.

## Staging

Staging runs the production build. The Worker rewrites what differs on the way out, decided by
hostname: the icons, the installed name, the landing page's links, and a `noindex` header. See
[deploy.md](deploy.md).

## Tests

The Worker's tests run inside Cloudflare's own runtime, against a fresh D1 with every migration
applied, as part of `npm test`.

## Where to look

| Where | What |
|---|---|
| `worker/src/index.js` | middleware (rate limits, CORS, caching), hostnames, the app's paths |
| `worker/src/routes/` | the auth, data and updates endpoints |
| `worker/src/lib/writes.js` | every write a push can make |
| `worker/src/lib/userData.js`, `listTree.js` | shaping the snapshot; repairing the list tree |
| `worker/src/auth.js`, `session.js`, `oauth.js`, `emailAuth.js` | accounts, sessions, the two sign-in flows |
| `worker/src/shareMeta.js` | link previews |
| `worker/src/stagingBrand.js`, `wellKnown.js` | staging's branding; native link verification |
| `worker/migrations/` | the schema |
| `wrangler.jsonc` | hostnames, bindings and variables, for production and staging |
