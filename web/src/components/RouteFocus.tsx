import { useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router';

/**
 * The element every page renders into. A navigation that leaves focus behind — on nothing, or on
 * the page that went — moves it here, so a keyboard or a screen reader carries on from the page
 * now on screen rather than from the top of the document.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  // The part of the address that names the page: a library node's own path, since selecting a
  // sutta there changes the list's selection rather than the page.
  const page = useMatch({ path: '/browse/:nodeId/*', caseSensitive: true })?.pathnameBase ?? pathname;
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ page: string; pathname: string } | null>(null);

  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { page, pathname };
    // Never on the first page, where focus starts wherever the browser puts it.
    if (!prev) return;
    // A different page, or back up to a library node's own page from one of its suttas.
    const arrived = page !== prev.page || (pathname !== prev.pathname && pathname === page);
    const el = ref.current;
    if (arrived && el && !el.contains(document.activeElement)) el.focus();
  }, [page, pathname]);

  return (
    <div ref={ref} tabIndex={-1} style={{ outline: 'none', height: '100%' }}>
      <Outlet />
    </div>
  );
}
