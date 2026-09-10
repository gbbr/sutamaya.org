import { isNativeApp, isStandaloneDisplay } from './platform';

// Sharing a link through the OS share sheet, offered only where the app runs without browser
// chrome — a native shell or an installed PWA — since a browser tab has its own share action in the
// address bar. The native shell goes through `@capacitor/share`, imported dynamically so it stays
// out of the browser bundle; an installed PWA uses the Web Share API.

// The origin a shared link points at: the app's public hostname, since a native WebView's own origin
// is local to the device.
const SHARE_ORIGIN = isNativeApp() ? 'https://app.sutamaya.org' : globalThis.location?.origin ?? '';

/** True for the rejection iOS and Android raise when the share sheet is dismissed without a destination. */
export function isShareCancellation(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return /cancel/i.test(err instanceof Error ? err.message : String(err));
}

/** True when this instance offers a share button: no browser chrome, and a share sheet to open. */
export function canShareLink(): boolean {
  if (isNativeApp()) return true;
  return isStandaloneDisplay() && typeof navigator.share === 'function';
}

/** The public URL of an app path, as a recipient opens it. */
export function shareUrl(path: string): string {
  return `${SHARE_ORIGIN}${path}`;
}

/**
 * Offers `url` to the OS share sheet, bare, so the recipient's link preview carries the title.
 * Resolves once the sheet has been dealt with, dismissing it included.
 */
export async function shareLink(url: string): Promise<void> {
  try {
    if (isNativeApp()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ url });
    } else {
      await navigator.share({ url });
    }
  } catch (err) {
    if (!isShareCancellation(err)) throw err;
  }
}
