import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  ],
  server: {
    port: 5173,
    // Listen on all interfaces (not just localhost) so the dev server is reachable from a
    // phone on the same LAN — Vite prints the LAN URL itself (as "Network:") once host is
    // enabled, no extra logging needed. /api/* is still proxied to the Express server on this
    // same machine (see below), so a phone's API calls work exactly the same way.
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
