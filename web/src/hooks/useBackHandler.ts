import { useEffect } from 'react';
import { registerBackHandler } from '../lib/backButton';
import { useLatest } from './useLatest';

// Registers `onBack` as the Android back button's dismiss action while `active` is true — closing an
// overlay, a drawer or a mobile sub-view one step at a time before the button navigates. The most
// recently activated handler runs first. A no-op on web and iOS.
export function useBackHandler(active: boolean, onBack: () => void): void {
  const latest = useLatest(onBack);
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => latest.current());
  }, [active, latest]);
}
