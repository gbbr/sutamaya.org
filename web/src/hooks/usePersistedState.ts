import { useEffect, useState } from 'react';

// State backed by one localStorage key, written on every change. A stored object is merged over
// `initial`, so a key gaining a field reads back with that field's default rather than undefined.
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // storage unavailable — ignore
    }
  }, [key, state]);

  return [state, setState];
}
