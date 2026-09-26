import type { MouseEvent } from 'react';
import { isNativeApp } from '../platform';

// opensHere reports whether a click on a link within the app opens it in this tab, with the app's
// own transition. A modified click (new tab, new window, download) is the browser's, except in the
// native apps, which have no tabs.
export function opensHere(e: MouseEvent<HTMLAnchorElement>): boolean {
  return isNativeApp() || !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}
