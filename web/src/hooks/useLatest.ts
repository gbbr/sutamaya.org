import { useRef } from 'react';

// A ref that always holds the most recent value passed to it.
//
// For callbacks read from inside a long-lived `window`/element listener: subscribing once and
// calling `ref.current(...)` keeps the listener off the re-subscription treadmill without it
// closing over a stale callback. The alternative — naming whatever the callback happens to close
// over in the effect's dependency array — re-subscribes on every one of those values *and*
// silently goes stale the moment the callback grows a dependency nobody remembers to add.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
