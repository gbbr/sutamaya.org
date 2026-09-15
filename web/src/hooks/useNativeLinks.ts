import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { App } from '@capacitor/app';
import { isNativeApp } from '../lib/platform';

// The origin the native apps are verified to open links for (docs/native-apps.md's "Links into the app").
const APP_LINK_ORIGIN = 'https://app.sutamaya.org';

// Session storage key for the last link opened, which the launch URL keeps returning after a reload
// in the same run of the app, such as an update swapping in.
const LAST_LINK_KEY = 'last_opened_link';

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
    // open goes to a link's page unless the reader is already on it, since iOS hands over the link
    // that launched the app twice: as the launch URL and as an event.
    function open(url: string) {
      if (!url.startsWith(`${APP_LINK_ORIGIN}/`)) return;
      sessionStorage.setItem(LAST_LINK_KEY, url);
      const link = new URL(url);
      const page = link.pathname + link.search;
      if (page === here.current) return;
      here.current = page;
      navigate(page);
    }

    let handle: { remove: () => void } | undefined;
    let removed = false;
    void App.addListener('appUrlOpen', ({ url }) => open(url)).then((h) => {
      if (removed) h.remove();
      else handle = h;
    });
    void App.getLaunchUrl().then((launch) => {
      if (launch?.url && launch.url !== sessionStorage.getItem(LAST_LINK_KEY)) open(launch.url);
    });
    return () => {
      removed = true;
      handle?.remove();
    };
  }, [navigate]);
}
