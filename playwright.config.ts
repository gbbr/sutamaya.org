import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: a real browser against the real app. `npm run test:e2e` — deliberately not
// part of `npm test`, which stays the fast unit suite.
//
// By default this drives the local dev stack (Vite + wrangler + a local D1), starting it if it
// isn't already running. Point E2E_BASE_URL at a deployed origin to run the same specs there;
// `webServer` then drops out, so nothing local is started or assumed. Only the specs tagged
// @smoke are safe against a real deployment — the rest write user data. See docs/e2e.md.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const external = Boolean(process.env.E2E_BASE_URL);

// The offline specs need the real, built service worker: a dev-mode one has no app shell to
// precache, so a reload with the network cut fails outright. They therefore run against
// `vite preview` over a production build, on its own port so it never contends with
// `npm run dev`, proxying /api to the same Worker on 8787 — one database, one session, both
// servers. `npm run test:e2e` sets E2E_OFFLINE, so the one command still covers everything; a
// bare `npx playwright test`, or a run narrowed to one project by hand, leaves this project and
// its build out rather than paying for a server it has no test for.
const PREVIEW_BASE_URL = 'http://localhost:5273';
const offline = Boolean(process.env.E2E_OFFLINE) && !external;

export default defineConfig({
  testDir: './e2e',
  // One worker, everywhere. Parallel files share one Worker instance and one rate-limit budget,
  // and `GET /api/auth/me` — fired on every page load and every reload — is metered tightly
  // enough that two concurrent specs start collecting 429s. The whole suite is a browser and a
  // few seconds per test, so serial costs little and keeps a 429 meaningful when one shows up.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Kept on the first retry rather than every run: a trace is the thing that actually explains a
    // failure, and it costs a few MB per test.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: external ? undefined : './e2e/global-setup.ts',
  globalTeardown: external ? undefined : './e2e/global-teardown.ts',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: ['**/offline/**', '**/mobile/**'] },
    // Playwright's WebKit, not Safari: close enough to catch WebKit-only rendering and JS
    // differences, but it is not iOS and does not reproduce ITP's cookie policies or PWA
    // standalone mode. Those still need a real device.
    //
    // The sync specs are left out: they are about data moving between devices rather than about
    // rendering, so a second engine tells us nothing new, and they are the slowest specs in the
    // suite — each one drives two browser contexts through a real round trip to the Worker.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/offline/**', '**/sync/**', '**/mobile/**'],
    },
    // A phone-width viewport with touch, which is a different app: under LayoutContext's 860px
    // breakpoint the library is one pane at a time rather than two, and every gesture arrives as
    // a touch. Chromium rather than mobile WebKit — what this project is for is layout and touch,
    // not iOS fidelity, which Playwright can't give at all (see docs/e2e.md); Chromium's touch
    // emulation is the steadier of the two.
    //
    // Signed-out journeys only, like webkit: the sync specs are about data rather than layout.
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testIgnore: ['**/offline/**', '**/sync/**'],
    },
    // Chromium only, against the built app: these drive the service worker, and nothing in them
    // is about rendering, so a second browser would double the slowest specs in the suite for no
    // new information.
    ...(offline
      ? [
          {
            name: 'offline',
            testMatch: '**/offline/**',
            use: { ...devices['Desktop Chrome'], baseURL: PREVIEW_BASE_URL },
          },
        ]
      : []),
  ],
  // The two halves are listed separately rather than as one `npm run dev`, so that a half already
  // running is reused and only the missing one is started — a web dev server up on its own is the
  // normal state of this machine, and starting `npm run dev` over it would fight for port 5173
  // while every /api/* call 500s against a proxy with nothing behind it.
  webServer: external
    ? undefined
    : [
        {
          command: 'npm run dev:worker',
          // Answered by the Worker itself, and 200 with `{user: null}` when signed out.
          url: 'http://localhost:8787/api/auth/me',
          timeout: 60 * 1000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          // The corpus bundle web/public/data/ is git-ignored and built, so a clean checkout (CI)
          // has to build it before the dev server can serve anything. Only when it's missing:
          // build-corpus.mjs rewrites that directory in place, and doing that unconditionally
          // would pull it out from under any other dev server already serving it.
          command: '[ -f web/public/data/corpus.json ] || npm run build:corpus; npm run dev:web',
          url: baseURL,
          // Minutes from cold, almost all of it the corpus build.
          timeout: 5 * 60 * 1000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // Only for the offline project. It builds first, every run: `web/dist` is not this
        // suite's to keep current, and a preview served from a stale one would quietly test code
        // that is no longer here. Hence `reuseExistingServer: false` too — reusing a server would
        // skip the build that makes it trustworthy. The build is a few seconds; the corpus it
        // needs is handled by the dev server entry above.
        //
        // `npm run … --workspace web`, not a root alias: the flags after `--` have to reach Vite
        // rather than being eaten by an outer npm. strictPort makes a taken 5273 fail loudly
        // instead of drifting onto a port nothing addresses.
        ...(offline
          ? [
              {
                command:
                  'npm run build --workspace web && npm run preview --workspace web -- --port 5273 --strictPort',
                url: PREVIEW_BASE_URL,
                timeout: 2 * 60 * 1000,
                reuseExistingServer: false,
                stdout: 'pipe' as const,
                stderr: 'pipe' as const,
              },
            ]
          : []),
      ],
});
