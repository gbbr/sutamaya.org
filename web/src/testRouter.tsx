import { render } from '@testing-library/react';
import { createMemoryRouter, type MemoryRouterOpts, type RouteObject } from 'react-router';
import { RouterView } from './components/RouterView';

/** An address to start on, with the history state a real arrival there carries. */
export type RouteEntry = NonNullable<MemoryRouterOpts['initialEntries']>[number];

/**
 * Renders `routes` in a memory router starting on `entry`, the way the app renders its own. An
 * address none of them match renders nothing rather than the router's own 404 page.
 */
export function renderRoutes(routes: RouteObject[], entry: RouteEntry) {
  const router = createMemoryRouter([...routes, { path: '*', element: null }], { initialEntries: [entry] });
  return { router, ...render(<RouterView router={router} />) };
}
