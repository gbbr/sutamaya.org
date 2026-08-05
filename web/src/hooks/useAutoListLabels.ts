import { useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';

// The "Highlights"/"Notes" auto-list labels (see server/src/routes/data.js's buildUserData) —
// `membership` only carries label strings, not ListDef.auto, so callers that need to tell a
// real user list apart from an auto one in a chip row look it up here instead.
export function useAutoListLabels() {
  const { lists } = useUserData();
  return useMemo(() => new Set(lists.filter((l) => l.auto).map((l) => l.label)), [lists]);
}
