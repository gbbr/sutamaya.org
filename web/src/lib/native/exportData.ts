import { Capacitor, registerPlugin } from '@capacitor/core';
import { dataApi } from '../api';
import { isShareCancellation } from './share';

// The account export on native, where the browser's download is unavailable twice over: a WebView
// navigation to the API leaves the app for the system browser, which carries neither the cookie nor
// the bearer token, and the WebView could not save the response if it did. So the app fetches the
// payload itself, writes it into its own cache directory and hands that file on: to the system
// "Save as" picker on Android, whose share sheet has no destination on the device itself, and to
// the OS share sheet on iOS, where Save to Files is one. The web build downloads
// `dataApi.exportUrl` as a plain link instead (SettingsPage).
//
// Filesystem and Share are imported dynamically: neither is on the startup path a Capacitor plugin
// may not be reached from, and both are dead weight in the browser bundle.

// Matches the filename the Worker's Content-Disposition gives the web download.
const FILE_NAME = 'sutamaya-export.json';

// The Android app's own "Save as" plugin (SaveFilePlugin.java); absent on iOS and in older Android
// builds.
const SaveFile = registerPlugin<{ saveAs(options: { file: string; type: string }): Promise<void> }>('SaveFile');

/**
 * Fetches the account export and offers it to the "Save as" picker where the app has one, the OS
 * share sheet otherwise. Resolves once that has been dealt with, dismissing it included; rejects
 * only if the export itself could not be produced.
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

  if (Capacitor.isPluginAvailable('SaveFile')) {
    await SaveFile.saveAs({ file: uri, type: 'application/json' });
    return;
  }
  try {
    await Share.share({ title: 'Sutamaya export', files: [uri] });
  } catch (err) {
    if (!isShareCancellation(err)) throw err;
  }
}
