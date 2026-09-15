import { useEffect, useRef } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { App } from '@capacitor/app';
import { isNativeApp } from '../lib/platform';
import { tagIntent } from '../lib/routeIntent';

// The origin the native apps are verified to open links for (docs/native-apps.md's "Links into the app").
const APP_LINK_ORIGIN = 'https://app.sutamaya.org';

// Session storage key for the last link opened, which the launch URL keeps returning after a reload
// in the same run of the app, such as an update swapping in.
const LAST_LINK_KEY = 'last_opened_link';

// Session storage key for the launch URL once opened, which a reload hands back even after later links.
const LAUNCH_LINK_KEY = 'opened_launch_link';

/**
 * useNativeLinks opens the page a verified link names, once, at the app root: the link that
 * launched the app, and any that arrive while it runs.
 */
export function useNativeLinks(): void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // The page the reader is on, for a link that arrives between renders.
  const here = useRef('');
  useEffect(() => {
    here.current = pathname + search;
  }, [pathname, search]);

  useEffect(() => {
    if (!isNativeApp()) return;
    // open goes to a link's page. A link to the page already shown changes nothing, since iOS hands
    // over the link that launched the app twice, as the launch URL and as an event — except a
    // Library link, which opens its pane again in place.
    function open(url: string) {
      if (!url.startsWith(`${APP_LINK_ORIGIN}/`)) return;
      sessionStorage.setItem(LAST_LINK_KEY, url);
      const link = new URL(url);
      // The app's own address, which opens the app wherever the reader left it.
      if (link.pathname === '/') return;
      const page = link.pathname + link.search;
      const library = matchPath({ path: '/browse/*', caseSensitive: true }, link.pathname);
      const shown = page === here.current;
      if (shown && !library) return;
      here.current = page;
      navigate(page, { replace: shown, state: library ? tagIntent({ link: true }) : undefined });
    }

    let handle: { remove: () => void } | undefined;
    let removed = false;
    void App.addListener('appUrlOpen', ({ url }) => open(url)).then((h) => {
      if (removed) h.remove();
      else handle = h;
    });
    void App.getLaunchUrl().then((launch) => {
      const url = launch?.url;
      if (!url || url === sessionStorage.getItem(LAST_LINK_KEY) || url === sessionStorage.getItem(LAUNCH_LINK_KEY)) return;
      sessionStorage.setItem(LAUNCH_LINK_KEY, url);
      open(url);
    });
    return () => {
      removed = true;
      handle?.remove();
    };
  }, [navigate]);
}
