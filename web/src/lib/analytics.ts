// Cloudflare Web Analytics — aggregate visit/pageview counts only (cookie-less, no personal data).
// Manually registered against the sutamaya.org site tag in the Cloudflare dashboard, not tied to
// any DNS/proxy change. It sees SPA route changes on its own (it hooks the History API's
// pushState/popstate), so it reports real in-app navigation rather than just the entry URL.
//
// Loaded from here rather than as a <script> in index.html, because in the app shell it is the one
// resource on the startup path that the service worker does not serve from the precache. As a
// plain tag it stalled every launch on a lossy network:
//
//   A `type="module"` or `defer` script is executed in document order with the other deferred
//   scripts, and the app's own bundle is one of them. A network that *refuses* connections
//   (airplane mode) fails the beacon's fetch at once and the queue moves on — which is why offline
//   launches were always instant. A network that silently *drops* packets instead leaves the fetch
//   retransmitting for as long as the OS allows, and the app bundle — already in the precache,
//   already downloaded — cannot execute until it settles. The launch sits on index.html's static
//   splash indefinitely.
//
// `async` would fix the ordering but not the load event, which such a fetch also holds open, and
// registerSW() (main.tsx) waits on exactly that: vite-plugin-pwa registers with `immediate: false`,
// so workbox-window awaits `load` before it registers or checks for an update.
//
// Injecting after `load` has fired is what leaves nothing waiting at any point: the deferred queue
// has drained, the load event is over, and the service worker is registered. A dropped-packet
// network then costs one socket hanging in the background and nothing else.
//
// The trade is that a session ending within a second or so of launch may go uncounted. On the slow
// networks this exists to fix, such a session was never counted anyway.

const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
const TOKEN = '9ccb5acc36b045d1a2ae008a1c61e694';

// Runs `fn` once the load event is behind us, so whatever it starts can hold nothing open.
function afterLoad(fn: () => void): void {
  if (document.readyState === 'complete') {
    fn();
    return;
  }
  window.addEventListener('load', fn, { once: true });
}

// Injects the beacon. A classic script rather than the module the tag used to be: the beacon reads
// its token from `document.currentScript`, which is always null inside a module and left it
// falling back to a `script[data-cf-beacon]` query. Cloudflare's own documented snippet is a
// classic script too.
export function loadAnalytics(): void {
  if (typeof document === 'undefined') return;
  afterLoad(() => {
    // A dropped request is the case this whole module is about, and there is no offline queue to
    // put it in — the beacon reports a visit as it happens or not at all. Skipping a launch the
    // browser already knows has no network saves a socket that could only ever time out.
    if (!navigator.onLine) return;
    const el = document.createElement('script');
    el.src = BEACON_SRC;
    el.defer = true;
    el.setAttribute('data-cf-beacon', JSON.stringify({ token: TOKEN }));
    document.head.appendChild(el);
  });
}
