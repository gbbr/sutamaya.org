import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { BRAND_ICONS } from '../scripts/lib/brandIcons.mjs';

const landingPath = fileURLToPath(new URL('./public/landing.html', import.meta.url));

// Returns the commit this build was made from, as its short id and its subject line. The id carries
// a trailing "*" when the working tree was dirty, so a build made over uncommitted edits says so.
// Only staging displays them (see lib/buildInfo.ts); empty strings where git can't answer.
function buildCommit(): { id: string; subject: string } {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  try {
    return {
      id: `${git('log', '-1', '--pretty=%h')}${git('status', '--porcelain') ? '*' : ''}`,
      subject: git('log', '-1', '--pretty=%s'),
    };
  } catch {
    return { id: '', subject: '' };
  }
}

const commit = buildCommit();

// Extra hostnames the dev server's Host-header guard accepts beyond localhost/LAN IPs (see
// `allowedHosts` below), paired with how to actually reach the app through each one — printed
// on `npm run dev` startup so it doesn't have to be remembered/looked up each time.
//
// They are the two production hostnames' local stand-ins, so a dev session reproduces the split
// the deployed site has: the marketing site and the app on separate origins. Both need
// `caddy run` in a separate terminal — see docs/deploy.md "Testing on mobile".
const LANDING_HOST = 'local.sutamaya.org';
const APP_HOST = 'app.local.sutamaya.org';

const devHosts: Record<string, string> = {
  [LANDING_HOST]: `https://${LANDING_HOST}  (the landing page — stands in for sutamaya.org)`,
  [APP_HOST]: `https://${APP_HOST}  (the app — stands in for app.sutamaya.org)`,
};

// The dev server's own icon set: staging's treatment in green (scripts/make-brand-icons.mjs), so a
// tab, a dock and a home screen say which of the three — local, staging, production — they point
// at. The files sit in public/ like any other asset; only the rewrite below reaches them, so a
// production build references none of them.
const LOCAL_ICON_BASE = '/icons/local/';

// Production icon URL -> its local counterpart, read off the icon list so the two can't drift.
const localIcons = new Map(
  BRAND_ICONS.map((icon) => [icon.source.replace('web/public', ''), `${LOCAL_ICON_BASE}${icon.out}`])
);

// Returns HTML — the app shell or the landing page — with its icons pointed at the local set.
function localIconHtml(html: string): string {
  let out = html;
  for (const [from, to] of localIcons) out = out.replaceAll(from, to);
  return out;
}

export default defineConfig({
  define: {
    __BUILD_COMMIT_ID__: JSON.stringify(commit.id),
    __BUILD_COMMIT_SUBJECT__: JSON.stringify(commit.subject),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Versioned filename — see the note beside the <link rel="icon"> in index.html.
      includeAssets: ['favicon-32-v3.png', 'favicon-16-v3.png'],
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
        // "/" — the default, and the app's own entry point on its own hostname. It restores
        // whatever was last open, which is what makes relaunching from the home-screen icon
        // return the reader to where they were; see RestoreLastLocation in src/App.tsx. The
        // landing page is not a path this manifest has to work around, because it is on the
        // marketing hostname and so outside this scope entirely (see wrangler.jsonc).
        start_url: '/',
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
        // The landing page and the two policy pages belong to the marketing hostname, which runs
        // no service worker at all (see wrangler.jsonc); precaching them here would put pages this
        // origin never serves into every install. The images under landing/ match none of the
        // patterns above already.
        globIgnores: [
          '**/gelasio-*.woff2',
          '**/gentium-*.woff2',
          'landing.html',
          'privacy.html',
          'terms.html',
        ],
        navigateFallbackDenylist: [/^\/api\//],
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
            // The two search blobs and their map (see docs/search.md), fetched when a search field
            // is first focused. CacheFirst, unlike the /data/ paths above, because their filenames
            // carry the corpus's dataVersion: a corrected sutta arrives as a new URL, so there is
            // nothing to revalidate. Three entries, one corpus: only the current version's URLs are
            // ever requested, so a previous version's copies would sit unread until eviction.
            urlPattern: /\/data\/search\/.*\.(txt|json)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'search-text', expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 * 24 * 365 } },
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
            urlPattern: /\/api\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    {
      // The dev server stands in for both production hostnames, and which one it is playing is
      // decided the same way the Worker decides it — by the Host header (see MARKETING_HOSTS in
      // worker/src/index.js). Only LANDING_HOST is the marketing site, so "/" there is the
      // landing page; on `localhost` and APP_HOST "/" is the app, exactly as it is on
      // app.sutamaya.org. The landing page is also reachable on any host at /landing.html, which
      // is how to work on it without the Caddy setup in docs/deploy.md.
      //
      // It is served here rather than by Vite's static middleware because its links into the app
      // are absolute (they have to cross to the app's hostname, so a relative href would stay on
      // the marketing site) — and left alone, clicking one in dev would open the *production*
      // app. Rewriting them to this machine is what makes the landing → app hop testable locally.
      //
      // Registered inside configureServer rather than as a returned hook, which is what puts it
      // ahead of Vite's own HTML middleware rather than behind it.
      name: 'serve-landing-at-root',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const host = req.headers.host?.split(':')[0];
          const wantsLanding = req.url === '/landing.html' || (req.url === '/' && host === LANDING_HOST);
          if (!wantsLanding) return next();
          // Over Caddy the app is on APP_HOST; opened straight on localhost there is no second
          // hostname, so the app is wherever this page was asked for.
          const appOrigin = host === LANDING_HOST ? `https://${APP_HOST}` : `http://${req.headers.host}`;
          const html = readFileSync(landingPath, 'utf8').replaceAll('https://app.sutamaya.org', appOrigin);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(localIconHtml(html));
        });
      },
    },
    {
      // Points the app shell at the local icon set — see localIcons above. `apply: 'serve'` is
      // what keeps the rewrite out of a production build.
      name: 'serve-local-icons',
      apply: 'serve',
      transformIndexHtml: { order: 'post', handler: localIconHtml },
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
