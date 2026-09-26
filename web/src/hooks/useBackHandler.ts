import { useEffect } from 'react';
import { registerBackHandler } from '../lib/native/backButton';
import { useLatest } from './useLatest';

// Registers `onBack` as a dismiss action for the native apps' Back (useNativeBack) while `active` is
// true — closing an overlay, a drawer or a mobile sub-view one step at a time before Back navigates.
// The most recently activated handler runs first. A no-op on the web.
export function useBackHandler(active: boolean, onBack: () => void): void {
  const latest = useLatest(onBack);
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => latest.current());
  }, [active, latest]);
}
