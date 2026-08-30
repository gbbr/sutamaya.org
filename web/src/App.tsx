import { useEffect } from 'react';
import { Router, navigate, type RouteComponentProps } from '@reach/router';
import { AppProviders } from './context/AppProviders';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCorpus } from './context/CorpusContext';
import { getLastLocation } from './lib/lastLocation';
import { normalizeRouteId, resolveCanonicalSuttaId } from './lib/corpus';
import { markReturnNavigation } from './lib/entryKind';
import { HelpPage } from './pages/HelpPage';
import { LibraryPage } from './pages/LibraryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash() {
  return (
    <div data-component="Splash" className="flex items-center justify-center h-full bg-paper">
      <div className="text-ui-2xl text-ink-2" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-component="LoadFailed" className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center">
      <div className="font-serif text-ui-xl text-ink-2">Couldn't load the library. Check your connection and try again.</div>
      <button className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// What "/" resolves to. The bare origin is where both a fresh tab and a PWA relaunched from the
// home-screen icon land (it is the manifest's `start_url`), so restoring the last location here is
// what makes "close and reopen" return to wherever the user actually was. Navigates on mount, the
// same shape @reach/router's own <Redirect> uses, so it behaves correctly under this app's
// deliberate no-StrictMode setup (see main.tsx).
//
// The static landing page does not compete for this path: it is served on the marketing hostname,
// a different origin from the app entirely (see wrangler.jsonc).
//
// With nothing stored — a genuine first visit — it falls through to bare /browse, which selects
// no node. That's the point: TreePane force-expands the ancestors of whatever node is selected
// (ancestorsOf), so landing on any real node would greet a first-time reader with a tree already
// opened partway into one collection. Nothing selected means the whole canon collapsed to its
// five nikāyas, which is the thing worth seeing first.
function RestoreLastLocation(_props: RouteComponentProps) {
  const { corpus } = useCorpus();
  useEffect(() => {
    // A stored reader location whose uid this corpus no longer has — a refresh renamed or dropped
    // it — would restore a Not found page, and NotFoundPage's own way out comes back through here.
    // Checked at the restore rather than at the write: lib/lastLocation.ts knows nothing about the
    // corpus and is better off keeping it that way, and this runs once per launch with the corpus
    // already in hand (Routes renders nothing until it has loaded).
    const stored = getLastLocation();
    const uid = stored?.match(/^\/read\/([^/]+)$/)?.[1];
    // Through resolveCanonicalSuttaId, so a link naming one sutta of a batched document is judged
    // the same way the reader itself judges it.
    const restorable = uid && corpus ? !!corpus.suttas[resolveCanonicalSuttaId(corpus, decodeURIComponent(uid))] : !!stored;
    // A return, not a fresh choice of destination (see lib/entryKind.ts) — this *is* the user
    // reopening the app on whatever they last had open, so the reader restores its scroll.
    markReturnNavigation();
    navigate(restorable ? stored! : '/browse', { replace: true });
  }, []);
  return null;
}

// A bare-uid deep link — a shared "/dn9" rather than "/read/dn9". @reach/router ranks the static
// "/browse", "/read", "/settings" and "/help" routes above this dynamic one whatever the source
// order, so it only matches a single path segment none of those claim. Redirects to the reader when
// the id is a real sutta uid, and otherwise falls through to the same NotFoundPage the router's
// `default` renders.
function RedirectToReader({ suttaId }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  // Case-folded, since a link is usually copied from a reference the app displays in caps, and
  // redirected to the lowercase uid so the reader's own URL is the canonical one.
  const id = suttaId ? normalizeRouteId(suttaId) : suttaId;
  const known = Boolean(id && corpus?.suttas[id]);
  useEffect(() => {
    // Same as RestoreLastLocation above: this redirect finishes the load the user arrived with,
    // so it inherits that arrival's entry kind rather than counting as a fresh in-app navigation.
    if (known) {
      markReturnNavigation();
      navigate(`/read/${id}`, { replace: true });
    }
  }, [known, id]);
  if (!known) return <NotFoundPage />;
  return null;
}

function Routes() {
  const { loading, error, retry } = useCorpus();
  if (error) return <LoadFailed onRetry={retry} />;
  if (loading) return <Splash />;
  return (
    <Router style={{ height: '100%' }}>
      <RestoreLastLocation path="/" />
      {/* One route element (not two) so /browse/:nodeId and /browse/:nodeId/:suttaId share the
          same LibraryPage instance — see the comment on `suttaId` in LibraryPage.tsx for why:
          two separate route elements here would remount LibraryPage (and every pane's scroll
          position with it) every time a highlighted row is selected/deselected. `*suttaId` is a
          splat, giving '' (not undefined) when the segment is absent. */}
      <LibraryPage path="/browse/:nodeId/*suttaId" />
      {/* The library with nothing selected — a first visit, before the reader has picked
          anything. A second route element, so selecting the first node does remount LibraryPage
          per the note above; that costs a pane scroll position which on this one transition
          doesn't exist yet. */}
      <LibraryPage path="/browse" />
      <ReaderPage path="/read/:suttaId" />
      <SettingsPage path="/settings" />
      <HelpPage path="/help" />
      <RedirectToReader path="/:suttaId" />
      <NotFoundPage default />
    </Router>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <Routes />
      </AppProviders>
    </ErrorBoundary>
  );
}
