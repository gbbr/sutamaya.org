import { useRef } from 'react';

// Returns a ref holding the most recent value passed to it, for a callback read from inside a
// long-lived listener: subscribe once and call `ref.current(...)`, and the listener neither
// re-subscribes nor goes stale.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
