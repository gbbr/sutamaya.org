import { Router, Redirect } from '@reach/router';
import { AppProviders } from './context/AppProviders';
import { useCorpus } from './context/CorpusContext';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash() {
  return (
    <div data-component="Splash" className="flex items-center justify-center h-full bg-paper">
      <div className="font-serif text-[20px] text-ink/70">sutamaya</div>
    </div>
  );
}

function Routes() {
  const { loading } = useCorpus();
  if (loading) return <Splash />;
  return (
    <Router style={{ height: '100%' }}>
      <Redirect from="/" to="/browse/dn" noThrow />
      {/* One route element (not two) so /browse/:nodeId and /browse/:nodeId/:suttaId share the
          same LibraryPage instance — see the comment on `suttaId` in LibraryPage.tsx for why:
          two separate route elements here would remount LibraryPage (and every pane's scroll
          position with it) every time a highlighted row is selected/deselected. `*suttaId` is a
          splat, giving '' (not undefined) when the segment is absent. */}
      <LibraryPage path="/browse/:nodeId/*suttaId" />
      <ReaderPage path="/read/:suttaId" />
      <SettingsPage path="/settings" />
    </Router>
  );
}

export default function App() {
  return (
    <AppProviders>
      <Routes />
    </AppProviders>
  );
}
