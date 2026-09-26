import { useEffect, useState, useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import { AlertTriangle, ArrowDown, ArrowUpCircle, Check, RefreshCw } from 'lucide-react';
import { BUILD_COMMIT_ID } from '../lib/buildInfo';
import {
  applyUpdate,
  checkForUpdate,
  readUpdateStatus,
  subscribeUpdateReports,
  updateReport,
  type UpdateStatus,
} from '../lib/native/otaUpdate';
import { platformName } from '../lib/platform';

// This app's page in its platform's store, and the words of the link to it.
const STORE =
  platformName() === 'android'
    ? { url: 'https://play.google.com/store/apps/details?id=org.sutamaya.app', text: 'Update on Google Play' }
    : { url: 'https://apps.apple.com/app/id6812033523', text: 'Update in the App Store' };

// The icon and words for each state of an update, the icon turning while a download is under way.
const STATUS_LINE: Record<UpdateStatus, { Icon: typeof RefreshCw; spin: boolean; text: string }> = {
  current: { Icon: Check, spin: false, text: 'Up to date' },
  downloading: { Icon: RefreshCw, spin: true, text: 'Downloading…' },
  ready: { Icon: ArrowDown, spin: false, text: 'Update ready' },
  failed: { Icon: AlertTriangle, spin: false, text: 'Update will retry' },
  store: { Icon: ArrowUpCircle, spin: false, text: STORE.text },
};

/**
 * Renders the app's store version, the commit its running bundle was built from, and what an
 * over-the-air update is doing, with a Restart once one is ready, or a link to the store when this
 * build is too old for it. Mounting it checks for an update.
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
  const line = status && STATUS_LINE[status];
  const icon = line && (
    <line.Icon
      size={13}
      strokeWidth={2}
      aria-hidden
      className={`flex-none ${line.spin ? 'animate-[spin_2s_linear_infinite]' : ''}`}
    />
  );
  return (
    <div
      data-component="AppVersion"
      className="flex flex-wrap items-center justify-center gap-x-2.5 font-sans text-ui-sm text-ink-4 mt-2"
    >
      <span>
        v{version}
        {BUILD_COMMIT_ID && ` (${BUILD_COMMIT_ID})`}
      </span>
      {line && (
        <>
          <span aria-hidden className="text-ink-5">
            ·
          </span>
          {status === 'store' ? (
            <a href={STORE.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text">
              {icon}
              <span className="underline decoration-accent-text/40 underline-offset-2">{line.text}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1">
              {icon}
              {line.text}
            </span>
          )}
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
