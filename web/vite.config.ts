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
        name: 'Sutamaya',
        short_name: 'Sutamaya',
        description: 'An offline-first reader for the Early Buddhist Texts.',
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
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // One entry per dictionary range shard (see scripts/build-corpus.mjs) — the reader
            // fetches only the shard a tapped word falls in, so these accumulate as words are
            // looked up, and "download for offline" fills in the rest.
            urlPattern: /\/data\/dict-shards\/.*\.json$/,
            handler: 'CacheFirst',
            options: { cacheName: 'dictionary', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /\/data\/text\/.*\.json$/,
            handler: 'CacheFirst',
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
            // mode. CacheFirst with no revalidation is safe here, unlike the unversioned /data/
            // paths (see CLAUDE.md "Cache staleness"), because Vite content-hashes these
            // filenames: a re-captured screenshot arrives as a new URL rather than a stale hit.
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
            urlPattern: /\/api\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
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
});
