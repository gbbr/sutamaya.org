import { useEffect } from 'react';
import { DEFAULT_TITLE, setMetaDescription } from '../lib/documentMeta';

// Sets the tab title and meta description while a page is mounted, restoring index.html's defaults
// on the way out. Omit `description` where a page has no subject of its own to describe.
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
