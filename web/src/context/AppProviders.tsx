import type { ReactNode } from 'react';
import { AuthProvider } from './AuthContext';
import { CorpusProvider } from './CorpusContext';
import { UserDataProvider } from './UserDataContext';
import { ReaderPrefsProvider } from './ReaderPrefsContext';
import { LayoutProvider } from './LayoutContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CorpusProvider>
        <UserDataProvider>
          <ReaderPrefsProvider>
            <LayoutProvider>{children}</LayoutProvider>
          </ReaderPrefsProvider>
        </UserDataProvider>
      </CorpusProvider>
    </AuthProvider>
  );
}
