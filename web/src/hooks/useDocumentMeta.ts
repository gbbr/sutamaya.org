import { useEffect } from 'react';
import { DEFAULT_TITLE, setMetaDescription } from '../lib/documentMeta';

// Sets the tab title and the meta description for whichever page is mounted, and puts both back on
// the way out so an unmounting page never leaves its own text behind. Every page that has something
// specific to say calls this; anything that doesn't keeps index.html's defaults.
//
// `description` is optional: pass a group or sutta blurb where there is one, and leave it out
// otherwise — the app-wide default is the right description for a page with no subject of its own.
export function useDocumentMeta(title: string, description?: string | null): void {
  useEffect(() => {
    document.title = title || DEFAULT_TITLE;
    setMetaDescription(description);
    return () => {
      document.title = DEFAULT_TITLE;
      setMetaDescription(null);
    };
  }, [title, description]);
}
