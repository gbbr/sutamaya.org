import { useRef } from 'react';

// A ref that always holds the most recent value passed to it.
//
// For callbacks read from inside a long-lived window or element listener: subscribe once and call
// `ref.current(...)`, so the listener neither re-subscribes on every render nor closes over a stale
// callback. Naming what the callback closes over in the effect's dependency array instead
// re-subscribes on all of those values, and goes stale as soon as the callback grows a dependency
// nobody adds.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
