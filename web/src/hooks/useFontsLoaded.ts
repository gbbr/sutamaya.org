import { useLayoutEffect, useState } from 'react';

// How long text waits for its fonts before it is shown in their stand-ins anyway.
const FONT_WAIT_CAP_MS = 1000;

// useFontsLoaded returns whether the text rendered from `content` has its fonts: false from the
// commit that first renders a new `content` until every font its layout asked for has loaded, or
// FONT_WAIT_CAP_MS has passed.
export function useFontsLoaded(content: object | null | undefined): boolean {
  const [loadedFor, setLoadedFor] = useState<object | null>(null);

  useLayoutEffect(() => {
    if (!content) return;
    // Lays the new text out, which is what asks for its fonts.
    document.body.getBoundingClientRect();
    // The CSS Font Loading API, absent only where a browser has it switched off.
    const fonts: FontFaceSet | undefined = document.fonts;
    if (!fonts) console.warn('useFontsLoaded: no CSS Font Loading API, so text is shown without waiting for its fonts');
    if (fonts?.status !== 'loading') {
      setLoadedFor(content);
      return;
    }
    let live = true;
    const done = () => {
      if (live) setLoadedFor(content);
    };
    const cap = setTimeout(done, FONT_WAIT_CAP_MS);
    fonts.ready.then(done, done);
    return () => {
      live = false;
      clearTimeout(cap);
    };
  }, [content]);

  return !!content && loadedFor === content;
}
