import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Extra hostnames the dev server's Host-header guard accepts beyond localhost/LAN IPs (see
// `allowedHosts` below), paired with how to actually reach the app through each one — printed
// on `npm run dev` startup so it doesn't have to be remembered/looked up each time.
const devHosts: Record<string, string> = {
  'gbbr.local': 'http://gbbr.local:5173',
  'local.sutamaya.org':
    'https://local.sutamaya.org  (needs `caddy run` in a separate terminal — see deploy.md "Testing on mobile")',
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Sutamaya',
        short_name: 'Sutamaya',
        description: 'An offline-first reader for the Early Buddhist Texts.',
        theme_color: '#FDFCFA',
        background_color: '#FDFCFA',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Corpus navigation (small: a few MB) is precached with the app shell so browsing
        // works offline from the first load. The dictionary (~20MB) and per-sutta text
        // (~58MB across the whole canon) are cached on first use instead of forced into
        // every install — CorpusProvider fetches the dictionary on boot, so in practice it's
        // cached within seconds of the first visit anyway. See CLAUDE.md "Offline strategy".
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'data/corpus.json'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/data\/dictionary\.json$/,
            handler: 'CacheFirst',
            options: { cacheName: 'dictionary', expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 365 } },
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
    // machine's LAN IP) fronted locally by Caddy on :443 — see deploy.md "Testing on mobile" —
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
