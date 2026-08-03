import { Router, Redirect } from '@reach/router';
import { AppProviders } from './context/AppProviders';
import { useCorpus } from './context/CorpusContext';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-paper">
      <div className="font-serif text-[20px] text-ink/70">sutamaya</div>
    </div>
  );
}

function Routes() {
  const { loading } = useCorpus();
  if (loading) return <Splash />;
  return (
    <Router style={{ height: '100%' }}>
      <Redirect from="/" to="/browse/mn" noThrow />
      <LibraryPage path="/browse/:nodeId" />
      <LibraryPage path="/browse/:nodeId/:suttaId" />
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
