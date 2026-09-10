import { useEffect } from 'react';
import { createBrowserRouter, useLocation, useNavigate, useParams, type RouteObject } from 'react-router';
import { AppProviders } from './context/AppProviders';
import { ErrorBoundary, ErrorFallback } from './components/ErrorBoundary';
import { RouteFocus } from './components/RouteFocus';
import { RouterView } from './components/RouterView';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';
import { useCorpus } from './context/CorpusContext';
import { getLastLocation, rememberLocation } from './lib/lastLocation';
import { normalizeRouteId, resolveCanonicalSuttaId } from './lib/corpus';
import { RETURN_STATE } from './lib/entryKind';
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
// first visit. Navigates on mount, in place of the "/" entry.
function RestoreLastLocation() {
  const { corpus } = useCorpus();
  const navigate = useNavigate();
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
    navigate(restorable ? stored! : '/browse', { replace: true, state: RETURN_STATE });
  }, []);
  return null;
}

// Sends a bare-uid deep link — a shared "/dn9" rather than "/read/dn9" — to the reader, and
// renders NotFoundPage for anything else. The router ranks the static routes above this one, so
// it sees only a single segment none of them claim.
function RedirectToReader() {
  const { suttaId } = useParams();
  const { corpus } = useCorpus();
  const navigate = useNavigate();
  // Case-folded, since such a link is usually copied from a reference the app displays in caps.
  const id = suttaId ? normalizeRouteId(suttaId) : suttaId;
  const known = Boolean(id && corpus?.suttas[id]);
  useEffect(() => {
    // The redirect finishes the arrival it came in on, so it inherits that entry kind rather than
    // counting as a fresh in-app navigation.
    if (known) navigate(`/read/${id}`, { replace: true, state: RETURN_STATE });
  }, [known, id, navigate]);
  if (!known) return <NotFoundPage />;
  return null;
}

// The page the address names, once the corpus it is drawn from is in.
function Pages() {
  const { loading, error, retry } = useCorpus();
  if (error) return <LoadFailed onRetry={retry} />;
  if (loading) return <Splash />;
  return <RouteFocus />;
}

// What surrounds every page: the providers, Android's back button, and the record of where the
// reader is that "/" restores.
function AppShell() {
  useAndroidBackButton();
  const { pathname } = useLocation();
  useEffect(() => rememberLocation(pathname), [pathname]);
  return (
    <AppProviders>
      <Pages />
    </AppProviders>
  );
}

// Every route matches its static segments exactly as written: "/Settings" is a bare-uid link that
// RedirectToReader turns away, and "/READ/dn1" is no route at all.
const exact = (route: RouteObject): RouteObject => ({ ...route, caseSensitive: true });

const router = createBrowserRouter([
  {
    element: <AppShell />,
    // A throw in the shell or its providers, which the whole app gives way to.
    errorElement: <ErrorFallback />,
    children: [
      {
        // A throw in a page, caught inside the shell so its providers and the back button carry on.
        errorElement: <ErrorFallback />,
        children: [
          { path: '/', element: <RestoreLastLocation /> },
          // One route element, so selecting and deselecting a sutta keeps the same LibraryPage
          // instance and every pane's scroll position. The splat is the sutta, '' when absent.
          { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
          // The library with nothing selected. Keyed apart from the route above, so picking the
          // first node remounts the page — before there is any pane scroll to lose.
          { path: '/browse', element: <LibraryPage key="none" /> },
          { path: '/read/:suttaId', element: <ReaderPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/help', element: <HelpPage /> },
          { path: '/:suttaId', element: <RedirectToReader /> },
          { path: '*', element: <NotFoundPage /> },
        ].map(exact),
      },
    ],
  },
]);

export default function App() {
  return (
    <ErrorBoundary>
      <RouterView router={router} />
    </ErrorBoundary>
  );
}
