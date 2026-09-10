import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { RouteFocus } from './RouteFocus';
import { renderRoutes } from '../testRouter';

// Pages under the wrapper: two plain ones, and one shaped like the library, whose sutta selection
// stays on the same page.
const routes = [
  {
    element: <RouteFocus />,
    children: [
      { path: '/a', element: <button>page a</button> },
      { path: '/b', element: <p>page b</p> },
      { path: '/browse/:nodeId/*', element: <button>library</button> },
    ],
  },
];

// The wrapper a page renders into, which is where focus lands.
const wrapperOf = (el: HTMLElement) => el.closest('[tabindex="-1"]');

describe('RouteFocus', () => {
  it('takes no focus on the first page', () => {
    renderRoutes(routes, '/a');
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the new page when it was left on the page that went', async () => {
    const { router } = renderRoutes(routes, '/a');
    screen.getByRole('button', { name: 'page a' }).focus();
    await act(() => router.navigate('/b'));
    expect(document.activeElement).toBe(wrapperOf(screen.getByText('page b')));
  });

  it('leaves focus where it is when it is already on the page', async () => {
    const { router } = renderRoutes(routes, '/browse/dn');
    const row = screen.getByRole('button', { name: 'library' });
    row.focus();
    await act(() => router.navigate('/browse/mn'));
    expect(document.activeElement).toBe(row);
  });

  it('stays put when a sutta is selected on the same library page', async () => {
    const { router } = renderRoutes(routes, '/browse/dn');
    await act(() => router.navigate('/browse/dn/dn1'));
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus back to a library page on returning to it from one of its suttas', async () => {
    const { router } = renderRoutes(routes, '/browse/dn/dn1');
    await act(() => router.navigate('/browse/dn'));
    expect(document.activeElement).toBe(wrapperOf(screen.getByText('library')));
  });
});
