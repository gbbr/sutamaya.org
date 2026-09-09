// The stack of dismiss actions the Android hardware / gesture back button runs before it falls
// through to navigation. A component with something open — an overlay, a drawer, a mobile sub-view —
// pushes its close action while that thing is up; the back button pops the most recent one. Empty
// stack means the current screen has nothing to dismiss, and the back button navigates or
// backgrounds the app instead (see useAndroidBackButton).
//
// Inert on web and iOS: nothing calls runTopBackHandler there.

type BackHandler = () => void;

const stack: BackHandler[] = [];

// Registers a dismiss action, most-recent-first. Returns its unregister function.
export function registerBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i !== -1) stack.splice(i, 1);
  };
}

// Runs the top dismiss action, if any. Returns whether one ran.
export function runTopBackHandler(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}
