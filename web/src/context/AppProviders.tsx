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
          <ReaderPrefsProvider>
            <UiPrefsProvider>
              <LayoutProvider>{children}</LayoutProvider>
            </UiPrefsProvider>
          </ReaderPrefsProvider>
        </UserDataProvider>
      </CorpusProvider>
    </AuthProvider>
  );
}
