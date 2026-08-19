import { useEffect } from 'react';
import { Router, navigate, type RouteComponentProps } from '@reach/router';
import { AppProviders } from './context/AppProviders';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCorpus } from './context/CorpusContext';
import { getLastLocation } from './lib/lastLocation';
import { LibraryPage } from './pages/LibraryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash() {
  return (
    <div data-component="Splash" className="flex items-center justify-center h-full bg-paper">
      <div className="text-[20px] text-ink/70" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-component="LoadFailed" className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center">
      <div className="font-serif text-[17px] text-ink/70">Couldn't load the library. Check your connection and try again.</div>
      <button className="font-sans text-[14px] px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// What "/" resolves to. The bare origin is where both a fresh tab and a PWA relaunched from the
// home-screen icon land (vite-plugin-pwa's manifest start_url defaults to "/"), so restoring the
// last location here is what makes "close and reopen" return to wherever the user actually was
// rather than always to DN. Navigates on mount, the same shape @reach/router's own <Redirect>
// uses, so it behaves correctly under this app's deliberate no-StrictMode setup (see main.tsx).
function RestoreLastLocation(_props: RouteComponentProps) {
  useEffect(() => {
    navigate(getLastLocation() ?? '/browse/dn', { replace: true });
  }, []);
  return null;
}

// A bare-uid deep link (e.g. a shared "/dn9" instead of "/read/dn9"). @reach/router ranks the
// static "/browse", "/read", "/settings" routes above this dynamic one regardless of source
// order, so it only ever matches a single unknown-to-those path segment. Redirects to the reader
// when the id is a real sutta uid; otherwise falls through to the same NotFoundPage the router's
// own `default` renders for anything else unmatched.
function RedirectToReader({ suttaId }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  const known = Boolean(suttaId && corpus?.suttas[suttaId]);
  useEffect(() => {
    if (known) navigate(`/read/${suttaId}`, { replace: true });
  }, [known, suttaId]);
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
      <ReaderPage path="/read/:suttaId" />
      <SettingsPage path="/settings" />
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
