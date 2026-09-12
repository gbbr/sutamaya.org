# End-to-end tests

Playwright drives real browsers against the real app: real rendering, the service worker, the
IndexedDB mirror, and a real Worker on a local D1. It covers what unit tests can't — pointer drags,
the highlight popup, offline behaviour, two devices converging.

```
npm run test:e2e                          # everything
npm run test:e2e -- --project=chromium    # one project
npm run test:e2e -- --ui                  # pick a test, watch it run
npx playwright show-report                # the last run's report
```

It isn't part of `npm test`, which stays the fast unit suite.

**The suite stays small on purpose.** A browser test costs seconds, times every project it runs in,
so a test earns its place only by covering something no unit test can. Before keeping one, check
that it fails when the behaviour it describes is broken.

## Projects

| Project | Browser | Runs |
|---|---|---|
| `chromium` | desktop Chrome | the signed-out journeys in `e2e/`, and the signed-in ones in `e2e/sync/` |
| `webkit` | desktop Safari's engine | the signed-out journeys |
| `mobile` | a 393px Chromium with touch | the signed-out journeys, and the phone-only ones in `e2e/mobile/` |
| `offline` | Chromium, on a production build | `e2e/offline/`, which need the real service worker |

Below 860px the Library shows one pane at a time, so a few shared helpers (`openSuttaList`,
`openListsTab`, `searchResults`) let one spec read the same at either width.

The sync specs stay on Chromium: they're about data rather than rendering, and each drives two
browsers, so a second engine would double the slowest tests for nothing new.

## The servers

The config starts the Worker and the web dev server if they aren't running and reuses them if they
are, so an `npm run dev` already up is used as it is. A clean checkout builds the corpus first.

The `offline` project needs a third server: `vite preview` over a fresh production build, on port
5273. A dev-mode service worker has no app shell to precache, so a reload with the network cut
would simply fail. `npm run test:e2e` turns this project on; a bare `npx playwright test` leaves it
out.

## Signing in

Neither Google nor the emailed code can be scripted, so the signed-in specs mint the session cookie
directly, with the Worker's own code and the `SESSION_SECRET` in `.dev.vars`. A pool of accounts is
written to the local database before the run and removed after it; each test takes its own, and a
two-device spec signs its second browser into the same one.

**Nothing may write to the local database during a run.** A write landing while the Worker starts
kills it (`SQLITE_BUSY`), and every later test fails against an API that's gone. That's why the
accounts are written in the global setup, before any server starts.

## Isolation

Each test gets a fresh browser: empty IndexedDB and localStorage, and a new local account. Nothing
carries over between tests.

- **Wait for the mirror before a reload.** A spec that reloads to prove an edit stuck calls
  `waitForLocalWrites()` first; otherwise it tests how fast IndexedDB happens to be.
- **Each test gets its own client IP** (`cf-connecting-ip`), because the Worker rate-limits by it
  and `/api/auth/me` fires on every load. The suite runs on a single worker for the same reason.
- **Cut the network with `setOffline()`** from `e2e/fixtures.ts`, never directly, so the error
  fixture knows.

## The error fixture

Every test fails if its page logs a `console.error`, throws, or gets a 4xx or 5xx response. It is
the one exploratory part of the suite, catching what nobody thought to assert. The allowances stay
few, since each is a class of problem the suite stops seeing:

- a `401` from `/api/*`, the normal answer to the signed-out reader most specs are;
- console noise from Vite's dev server and the service worker;
- Cloudflare's analytics beacon, which is stubbed out entirely;
- failed requests, but only in a test that has cut its network with `setOffline()`.

## Reading a failure

The terminal names the failing assertion. The report keeps a trace for each failure — a timeline of
the DOM, console and network at every step, opened with `npx playwright show-trace <path>` — along
with a video and a screenshot.

## In CI

`.github/workflows/ci.yml` runs the suite as its own job on pull requests and pushes to `main`. A
clean checkout needs three things a dev machine already has: a `.dev.vars` with a throwaway
`SESSION_SECRET`, a built `web/dist` (which `wrangler dev` requires), and a migrated local database.
A failed run uploads the report.

## Against a deployment

```
E2E_BASE_URL=https://app.sutamaya.org npm run test:e2e -- --grep @smoke
```

`E2E_BASE_URL` drops the local servers. Only the `@smoke` specs are safe there: they run signed
out, so their writes stay in the browser and the sync is refused. The signed-in specs can't run
against a deployment, whose secret and database they don't have.

## What it can't cover

Playwright's WebKit is not Safari. It catches WebKit's rendering and JavaScript differences, but not
Safari's tracking prevention, installing the app, or iOS input and scrolling, and its touch is
synthesized. Those stay manual, on a real device.
