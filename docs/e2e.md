# End-to-end tests

Playwright drives a real browser against the real app: real rendering, real service worker, real
IndexedDB mirror, a real Worker on a local D1. It covers what unit tests can't reach — pointer
drags, the highlight popup, offline behaviour, two devices converging — and it is the only place
those paths are exercised end to end.

```
npm run test:e2e                        # everything
npm run test:e2e -- --project=chromium  # one browser
npm run test:e2e -- --ui                # pick a test, watch it run, re-run on save
npx playwright show-report              # the last run's HTML report
```

Deliberately not part of `npm test`, which stays the fast unit suite.

`e2e/` is in three parts. The files at the top level are the signed-out journeys, run on Chromium
and WebKit. `e2e/sync/` holds the ones that need an account: syncing between two devices, and
edits made with the network cut. `e2e/offline/` holds the few that need the real service worker.
The last two are Chromium only — they are about data and caching rather than rendering, and each
sync spec drives two browser contexts, so a second engine would double the slowest specs in the
suite for no new information.

## The servers

`playwright.config.ts` lists the Worker and the web dev server separately and reuses whichever is
already up, so a `npm run dev` you already have running is used as-is and nothing is started twice.
From nothing, both are started and the corpus bundle is built first if `web/public/data/` is
missing — only if missing, since rebuilding it in place would pull the corpus out from under a dev
server already serving it.

A third server serves the offline project: `vite preview` over a production build, on port 5273 so
it never contends with `npm run dev`, proxying `/api` to the same Worker on 8787. It exists because
a **dev-mode service worker cannot serve a reload offline** — Vite serves an unbundled module graph
in dev, so there is no app shell to precache, and `page.reload()` with the network cut fails
outright. Only the built app has the real precache manifest.

It rebuilds `web/dist` on every run and never reuses a running server, so a stale build can't stand
in for the current code. That costs a few seconds.

## Signing in

There is no scripted route through Google OAuth or the emailed code, so the signed-in specs mint
the session cookie directly with the Worker's own `createSessionCookie` (`worker/src/session.js`),
signed with `SESSION_SECRET` read from `.dev.vars`. `requireAuth` verifies that cookie without a
database round trip, so that is the whole of what "signed in" means to the API.

A pool of accounts, `e2e-user-00…`, is written into the local D1 by the global setup and removed by
the global teardown. Each test takes one of its own; a two-device spec signs its second context
into the account the first call returned.

**Those two are the only writes to that database, and both sit outside the run.** `wrangler d1
execute --local` opens the same SQLite file the Worker holds, and the two contend: a write that
lands while the Worker is starting kills it — `SQLITE_BUSY … The Workers runtime failed to start` —
and every test after that fails against an API that is no longer there. A global setup runs before
Playwright starts any server, which is the one moment nothing holds the file. Nothing may write to
D1 while tests are running.

An account needs a real `users` row even though `requireAuth` never looks: `AuthContext` asks
`GET /api/auth/me` for a profile, and a session naming an account that isn't there reads as signed
out in the UI. Each row carries a placeholder `google_id`, which that column requires.

## Reading a failure

The terminal names the failing assertion. Everything else is in the report:

- **trace** — a scrubbable timeline with the DOM, console and network at every step. This is the
  thing that actually explains a failure; open it with `npx playwright show-trace <path>`.
- **video** and **screenshot** — kept for failures only.

## Isolation

Each test gets a fresh browser context, so the IndexedDB mirror, localStorage preferences and the
`local-…` account all start empty. Nothing carries between tests, and no test needs an account.

A spec that reloads to prove an edit stuck must call `waitForLocalWrites()` first. User data
reaches IndexedDB a little after the UI has moved, and a test reloads within a millisecond of
clicking — without the wait it is asserting how fast IndexedDB happens to be, and it fails
intermittently.

Each test also gets its own `cf-connecting-ip`, because the Worker's rate limiter buckets by that
header and `GET /api/auth/me` — fired on every page load and reload — is metered at 20 a minute.
Without it the whole suite shares one budget and everything after the first dozen tests fails on a
429 that says nothing about the app. The suite runs on a single worker for the same reason.

Against a deployment this has no effect: Cloudflare sets that header at the edge, so a real burst
is rate-limited for real.

## The error fixture

`e2e/fixtures.ts` fails any test whose page logged a `console.error`, threw, or got a 4xx/5xx. It
is the one genuinely exploratory part of the suite: it catches problems nobody thought to assert.
Two allowances are made, and each one is a class of problem the suite can no longer see, so keep
the list short:

- `401` on `/api/*`, which is the normal answer for the signed-out reader most specs run as.
- Cloudflare's RUM beacon, stubbed out entirely — its CORS preflight can't succeed from a test
  origin, and real analytics shouldn't count test runs.
- Failed requests, but only in a test that has cut its network — see `setOffline()` in
  `fixtures.ts`, which is what every offline spec must use instead of `context.setOffline`
  directly. Going offline makes requests fail by definition; uncaught exceptions and the app's own
  `console.error` still fail those tests.

## Running against a deployment

```
E2E_BASE_URL=https://sutamaya.org npm run test:e2e -- --grep @smoke
```

`E2E_BASE_URL` drops the local servers from the config. **Only `@smoke` specs are safe there.**
They run signed out, so every write they make goes to that browser profile's own local mirror and
the flush is refused with a 401 — nothing reaches an account. The rest of the suite writes user
data and belongs against local dev.

Signed-in journeys can't run there: the session cookie is minted against the local `SESSION_SECRET`
and the account is seeded into the local database, neither of which exists for a deployment.

## What it doesn't cover

Playwright's WebKit is not Safari: it catches WebKit-only rendering and JS differences, but not
ITP's cookie policies, PWA install and standalone mode, or iOS input and scrolling. Touch is
synthesized events, good enough for the pointer-drag code and no evidence about how a gesture
feels. Those stay manual, on a real device.
