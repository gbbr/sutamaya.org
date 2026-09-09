import { dataApi } from './api';

// The account export on native, where the browser's download is unavailable twice over: a WebView
// navigation to the API leaves the app for the system browser, which carries neither the cookie nor
// the bearer token, and the WebView could not save the response if it did. So the app fetches the
// payload itself, writes it into its own cache directory and hands that file to the OS share sheet
// — Save to Files, Drive, mail, whatever the device offers. The web build downloads
// `dataApi.exportUrl` as a plain link instead (SettingsPage).
//
// The plugins are imported dynamically: neither is on the startup path a Capacitor plugin may not
// be reached from, and both are dead weight in the browser bundle.

// Matches the filename the Worker's Content-Disposition gives the web download.
const FILE_NAME = 'sutamaya-export.json';

// True for the rejection iOS and Android raise when the share sheet is dismissed without a
// destination, which is not a failure to report.
function isShareCancellation(err: unknown): boolean {
  return /cancel/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Fetches the account export and offers it to the OS share sheet. Resolves once the sheet has been
 * dealt with, dismissing it included; rejects only if the export itself could not be produced.
 */
export async function shareUserDataExport(): Promise<void> {
  const payload = await dataApi.exportPayload();
  const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  // The cache directory: the app's own container, so no storage permission is involved, and the OS
  // is free to reclaim the copy once it has been shared.
  await Filesystem.writeFile({
    path: FILE_NAME,
    data: JSON.stringify(payload),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({ path: FILE_NAME, directory: Directory.Cache });

  try {
    await Share.share({ title: 'Sutamaya export', files: [uri] });
  } catch (err) {
    if (!isShareCancellation(err)) throw err;
  }
}
