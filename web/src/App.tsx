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

// What "/" resolves to — the path a fresh tab and a home-screen relaunch both land on (the
// manifest's `start_url`): the reader's last location, or bare /browse with nothing selected on a
// first visit. Navigates on mount, as @reach/router's own <Redirect> does, which works under this
// app's no-StrictMode setup (main.tsx).
function RestoreLastLocation(_props: RouteComponentProps) {
  const { corpus } = useCorpus();
  useEffect(() => {
    // A stored reader location is restorable only while this corpus still has the uid; a refresh
    // may have renamed or dropped it. Checked here rather than at the write, since
    // lib/lastLocation.ts knows nothing about the corpus.
    const stored = getLastLocation();
    const uid = stored?.match(/^\/read\/([^/]+)$/)?.[1];
    // Through resolveCanonicalSuttaId, so a uid naming one sutta of a batched document is judged
    // as the reader judges it.
    const restorable = uid && corpus ? !!corpus.suttas[resolveCanonicalSuttaId(corpus, decodeURIComponent(uid))] : !!stored;
    // A return rather than a fresh destination (lib/entryKind.ts), so the reader restores its
    // scroll.
    markReturnNavigation();
    navigate(restorable ? stored! : '/browse', { replace: true });
  }, []);
  return null;
}

// Sends a bare-uid deep link — a shared "/dn9" rather than "/read/dn9" — to the reader, and
// renders NotFoundPage for anything else. @reach/router ranks the static routes above this one, so
// it sees only a single segment none of them claim.
function RedirectToReader({ suttaId }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  // Case-folded, since such a link is usually copied from a reference the app displays in caps.
  const id = suttaId ? normalizeRouteId(suttaId) : suttaId;
  const known = Boolean(id && corpus?.suttas[id]);
  useEffect(() => {
    // The redirect finishes the arrival it came in on, so it inherits that entry kind rather than
    // counting as a fresh in-app navigation.
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
      {/* One route element, so selecting and deselecting a sutta keeps the same LibraryPage
          instance and every pane's scroll position. `*suttaId` is a splat, giving '' rather than
          undefined when the segment is absent. */}
      <LibraryPage path="/browse/:nodeId/*suttaId" />
      {/* The library with nothing selected. A second route element, so picking the first node
          remounts the page — before there is any pane scroll to lose. */}
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
