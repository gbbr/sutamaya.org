import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Extra hostnames the dev server's Host-header guard accepts beyond localhost/LAN IPs (see
// `allowedHosts` below), paired with how to actually reach the app through each one — printed
// on `npm run dev` startup so it doesn't have to be remembered/looked up each time.
const devHosts: Record<string, string> = {
  'local.sutamaya.org':
    'https://local.sutamaya.org  (needs `caddy run` in a separate terminal — see docs/deploy.md "Testing on mobile")',
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Versioned filename — see the note beside the <link rel="icon"> in index.html.
      includeAssets: ['favicon-v2.svg'],
      // Off by default (the plugin's own default) since a dev-mode service worker can serve
      // stale responses and fight Vite's HMR. Opt in with PWA_DEV=1 when specifically testing
      // install/standalone behavior (e.g. via local.sutamaya.org — see docs/deploy.md "Testing on
      // mobile"); unregister the SW in DevTools → Application afterward so it doesn't linger
      // and cause unrelated stale-content confusion in later dev sessions.
      devOptions: { enabled: !!process.env.PWA_DEV },
      manifest: {
        name: 'sutamaya',
        short_name: 'sutamaya',
        description:
          'An offline reader and study app for the Pali suttas — lists, highlights, notes, ' +
          'and a Pali dictionary a tap away.',
        // Not "/", which is the static landing page written for people who have never opened the
        // app (web/public/landing.html). An installed copy launched from its home-screen icon
        // should go straight back to whatever was last open, which is what /app does — see
        // RestoreLastLocation in src/App.tsx.
        start_url: '/app',
        theme_color: '#FBF9F5',
        background_color: '#FBF9F5',
        display: 'standalone',
        // The `-vN` suffix is load-bearing: a browser caches an installed app's icons when it
        // installs, and re-reads them only when the manifest itself changes. Overwriting these
        // files in place leaves every existing install on the old artwork forever — uninstalling
        // and reinstalling doesn't clear it, and neither does clearing site data, because the
        // store is keyed by app id in the browser profile rather than by origin. Changing the
        // artwork therefore means bumping the suffix here and renaming the files to match.
        icons: [
          { src: 'icons/icon-192-v2.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512-v2.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Corpus navigation (small: a few MB) is precached with the app shell so browsing
        // works offline from the first load. The dictionary (~20MB) and per-sutta text
        // (~58MB across the whole canon) are cached on first use instead of forced into
        // every install — CorpusProvider fetches the dictionary on boot, so in practice it's
        // cached within seconds of the first visit anyway. See CLAUDE.md "Offline strategy".
        // Self-hosted fonts (index.css) follow the same split: only the latin/latin-ext subsets
        // (what Pali/English text actually uses) are precached; the cyrillic/greek/vietnamese
        // subsets — vendored only for parity with what Google Fonts was already serving — are
        // cached on first use like everything else below, not forced into every install.
        globPatterns: [
          '**/*.{js,css,html,svg}',
          '**/*-latin.woff2',
          '**/*-latin-ext.woff2',
          'data/corpus.json',
          // Small (tens of KB) shard index for Settings' bulk offline download — see
          // web/src/lib/offline.ts. Precached alongside corpus.json so "X% available offline" can
          // be computed on first load without a network round trip, same reasoning as corpus.json
          // itself. The shard bundle files it points to are NOT precached — CacheFirst on first
          // request, same as everything else in data/text/.
          'data/text-shards/manifest.json',
          // Which shard covers a given headword (~6KB). Precached because it is on the path of
          // every single word tap, and because without it an offline device can't even work out
          // which shard to look in, however many of them it has cached.
          'data/dict-shards/manifest.json',
        ],
        // Gelasio and Gentium are subset-per-range families like the four above, so they match the
        // latin/latin-ext patterns — but they exist only as the stand-ins Georgia and Palatino
        // fall back to on the platforms that don't ship those, and an Apple or Windows device
        // never requests a byte of either. Precaching them would put ~280KB into every install to
        // serve nobody. XCharter, the third stand-in, needs no entry here: it's a whole font, so
        // its filenames don't carry a subset suffix and the patterns never matched them.
        globIgnores: ['**/gelasio-*.woff2', '**/gentium-*.woff2'],
        // "/" is the static landing page, and both of these are needed to keep it that way once
        // the service worker is installed. Without the denylist entry, a navigation to "/" is
        // answered by the SPA shell like any other unknown path; without `directoryIndex: null`,
        // Workbox's precache matches "/" against the precached "/index.html" and does the same
        // thing one layer earlier. Between them an installed reader would never see the landing
        // page again, and neither would anyone they sent the link to who already had the app.
        navigateFallbackDenylist: [/^\/api\//, /^\/$/],
        directoryIndex: null,
        runtimeCaching: [
          // These two paths are unversioned — a corrected sutta or gloss keeps its URL — so they
          // revalidate rather than serving the cache forever. A read is answered from the cache
          // immediately (offline included, which is the whole point), and the fresh copy that the
          // background fetch brings back is what the *next* app start reads: loadSuttaText
          // memoizes per session, so nothing is ever swapped under a reader mid-sutta. Each
          // document therefore catches up on its own second online visit, so a device holds a mix
          // of versions for as long as it takes the reader to revisit — accepted, because the mix
          // drains as they read instead of persisting for the full year the entries live.
          {
            // One entry per dictionary range shard (see scripts/build-corpus.mjs) — the reader
            // fetches only the shard a tapped word falls in, so these accumulate as words are
            // looked up, and "download for offline" fills in the rest.
            urlPattern: /\/data\/dict-shards\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'dictionary', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /\/data\/text\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'sutta-text',
              expiration: { maxEntries: 8000, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // The help page's screenshots (see pages/HelpPage.tsx) — ~630KB that most installs
            // never open, so they are not precached; they land here on first view of /help, and
            // Settings' bulk offline download fills them in (prefetchHelpImages in lib/offline.ts)
            // so a device that has "downloaded all content" can still read the guide in airplane
            // mode. CacheFirst is right here, rather than the revalidation the /data/ paths above
            // need, because Vite content-hashes these filenames: a re-captured screenshot arrives
            // as a new URL rather than a stale hit, so there is nothing to revalidate against.
            urlPattern: /\/assets\/.*\.webp$/,
            handler: 'CacheFirst',
            options: { cacheName: 'help-images', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            // 40 rather than the file count: everything not precached lands here — the
            // cyrillic/greek/vietnamese subsets plus all three fallback families — and an entry
            // cap that a normal device can reach would evict a face mid-read.
            options: { cacheName: 'fonts', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // The landing page. Excluded from the precache and the navigation fallback above, so
            // without this it would be the one URL on the origin that fails outright offline.
            // NetworkFirst rather than the StaleWhileRevalidate the corpus paths use: it is a
            // handful of KB on a page nobody is mid-read of, so paying for a fresh copy when the
            // network is there costs nothing and avoids serving month-old marketing copy.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === '/',
            handler: 'NetworkFirst',
            options: { cacheName: 'landing', expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /\/api\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    {
      // In production the Worker answers "/" with public/landing.html (see worker/src/index.js);
      // the dev server has no Worker in front of it and would serve index.html — the app shell —
      // for the bare origin instead. Rewriting the path here makes `npm run dev:web` show the
      // same page at the same URL, so the landing page can be worked on without a deploy.
      // Registered inside configureServer rather than as a returned hook, which is what puts it
      // ahead of Vite's own HTML middleware rather than behind it.
      name: 'serve-landing-at-root',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/') req.url = '/landing.html';
          next();
        });
      },
    },
    {
      name: 'log-dev-hosts',
      apply: 'serve',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          console.log(
            `\n  Also reachable via:\n${Object.values(devHosts)
              .map((url) => `    ${url}`)
              .join('\n')}\n`
          );
        });
      },
    },
  ],
  server: {
    port: 5173,
    // Listen on all interfaces (not just localhost) so the dev server is reachable from a
    // phone on the same LAN — Vite prints the LAN URL itself (as "Network:") once host is
    // enabled, no extra logging needed. /api/* is still proxied to the Express server on this
    // same machine (see below), so a phone's API calls work exactly the same way.
    host: true,
    // `host: true` only controls which interfaces Vite listens on — separately, Vite 5.4+
    // rejects requests by their Host header (a DNS-rebinding guard) unless it's localhost, a
    // raw IP, or explicitly allowed here. A phone on the LAN reaches this machine by its mDNS
    // name (e.g. "gbbr.local"), not an IP, so that name needs to be listed explicitly.
    // "local.sutamaya.org" is a real public-DNS name (Cloudflare A record pointed at this
    // machine's LAN IP) fronted locally by Caddy on :443 — see docs/deploy.md "Testing on mobile" —
    // used only when a feature needs Google sign-in to work on a phone, which a bare LAN
    // IP/mDNS name can't do (Google rejects both as OAuth origins).
    allowedHosts: Object.keys(devHosts),
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the built app — the real service worker with its real precache
  // manifest, which the dev server cannot produce (it serves an unbundled module graph, so there
  // is no app shell to precache). It needs the same /api proxy the dev server has, since the
  // built app still talks to the Worker on its own port. Used by the end-to-end suite's offline
  // project; see docs/e2e.md.
  preview: {
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
