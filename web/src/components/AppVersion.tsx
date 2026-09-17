import { useEffect, useState, useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import { BUILD_COMMIT_ID } from '../lib/buildInfo';
import {
  applyUpdate,
  checkForUpdate,
  readUpdateStatus,
  subscribeUpdateReports,
  updateReport,
  type UpdateStatus,
} from '../lib/otaUpdate';

// The words for each state of an update.
const STATUS_TEXT: Record<UpdateStatus, string> = {
  current: 'Up to date',
  downloading: 'Downloading update…',
  ready: 'Update ready',
  failed: 'Update failed, will retry',
};

/**
 * Renders the app's store version, the commit its running bundle was built from, and what an
 * over-the-air update is doing, with a Restart once one is ready. Mounting it checks for an update.
 * For the foot of Settings in the native apps; renders nothing until the version is known.
 */
export function AppVersion() {
  const report = useSyncExternalStore(subscribeUpdateReports, updateReport);
  const [version, setVersion] = useState('');
  // Whether the updater runs, known once the check started on opening is under way.
  const [updaterRuns, setUpdaterRuns] = useState<boolean | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    App.getInfo().then(
      (info) => setVersion(info.version),
      () => {}
    );
    checkForUpdate().then(setUpdaterRuns, () => setUpdaterRuns(false));
  }, []);

  // The update's status, read again with each report from the updater.
  useEffect(() => {
    if (updaterRuns === null) return;
    let cancelled = false;
    readUpdateStatus(report, updaterRuns).then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [report, updaterRuns]);

  if (!version) return null;
  return (
    <div
      data-component="AppVersion"
      className="flex flex-wrap items-center justify-center gap-x-2.5 font-sans text-ui-sm text-ink-4 mt-2"
    >
      <span>
        Version {version}
        {BUILD_COMMIT_ID && ` (${BUILD_COMMIT_ID})`}
      </span>
      {status && (
        <>
          <span aria-hidden className="text-ink-5">
            ·
          </span>
          <span>{STATUS_TEXT[status]}</span>
        </>
      )}
      {status === 'ready' && (
        <>
          <span aria-hidden className="text-ink-5">
            ·
          </span>
          <button className="text-accent-text underline decoration-accent-text/40 underline-offset-2" onClick={applyUpdate}>
            Restart
          </button>
        </>
      )}
    </div>
  );
}
