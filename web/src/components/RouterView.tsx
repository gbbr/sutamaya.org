import { RouterProvider, type DataRouter } from 'react-router';
import { flushSync } from 'react-dom';
import { logRenderError } from './ErrorBoundary';

/** react-dom's `flushSync`, as the router's own prop types describe it: nothing comes back. */
const flushSyncUpdate = (fn: () => unknown) => void flushSync(fn);

/**
 * A router's pages, rendered the one way the app renders them — App.tsx, and every test that
 * mounts a page — so a page under test behaves as it does in the app.
 *
 * A route change renders in the same pass as the update that caused it rather than as a deferred
 * React transition, and a route's render error is logged the way ErrorBoundary logs one.
 *
 * The provider comes from `react-router` with react-dom's `flushSync` passed in, which is what
 * `react-router/dom` exports it as. One specifier for the provider and the hooks: outside a
 * bundler the two resolve to different builds of the package, each with its own router context,
 * and a hook then finds no provider.
 */
export function RouterView({ router }: { router: DataRouter }) {
  return (
    <RouterProvider
      router={router}
      flushSync={flushSyncUpdate}
      useTransitions={false}
      onError={(error, { errorInfo }) => logRenderError(error, errorInfo?.componentStack)}
    />
  );
}
