import type { ReactNode } from 'react';
import { AuthProvider } from './AuthContext';
import { CorpusProvider } from './CorpusContext';
import { UserDataProvider } from './UserDataContext';
import { ReaderPrefsProvider } from './ReaderPrefsContext';
import { UiPrefsProvider } from './UiPrefsContext';
import { LayoutProvider } from './LayoutContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CorpusProvider>
        <UserDataProvider>
          <UiPrefsProvider>
            <ReaderPrefsProvider>
              <LayoutProvider>{children}</LayoutProvider>
            </ReaderPrefsProvider>
          </UiPrefsProvider>
        </UserDataProvider>
      </CorpusProvider>
    </AuthProvider>
  );
}
