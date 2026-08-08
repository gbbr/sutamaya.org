import { useEffect } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { dataApi } from '../lib/api';
import type { AppTheme, ReaderFace } from '../lib/types';

const UI_SCALE_MIN = 0.85;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.05;

const THEME_OPTIONS: Array<{ id: AppTheme; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const UI_FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
  { id: 'times', label: 'Times' },
  { id: 'system', label: 'System' },
];

export function SettingsPage(_props: RouteComponentProps) {
  const { user, logout, loading, authError } = useAuth();
  const { uiScale, uiFace, theme, setUiScale, setUiFace, setTheme } = useUiPrefs();

  // Same genuine history-back as the "Back" button above (see its own comment) — Escape is the
  // conventional "leave this screen" key, and there's no free-text field here whose own Escape
  // handling would need to take priority over it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') navigate(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return null;

  // items-start, not the flex default (stretch) — stretch caps this column at the container's own
  // height, so its content overflows past its box (and past its own pb-10, which then sits inside
  // that capped box instead of after the real, overflowing end of the content) rather than growing
  // the column to its natural (taller) content height the way scrolling needs.
  return (
    <div data-component="SettingsPage" className="sc h-full bg-paper px-5 pt-10 flex justify-center items-start">
      <div className="w-full max-w-[420px] pb-10">
        {/* Genuine history-back (not navigate('/')) — `/` always redirects to /browse/mn (see
            App.tsx), which would silently discard whatever nodeId/list/scroll state the user
            had before opening Settings. */}
        <button className="flex items-center gap-1.5 font-sans text-[13px] text-ink/50 mb-6" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-6">Settings</div>

        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3">Display</div>

        <div className="mb-6">
          <div className="font-sans text-[14px] mb-2">Theme</div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                className={`h-9 rounded-field border font-sans text-[13px] ${
                  theme === t.id ? 'border-accent bg-accent text-[#FBFAF7]' : 'border-ink/[.22] text-ink/70'
                }`}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-baseline justify-between mb-2">
            <label htmlFor="ui-scale" className="font-sans text-[14px]">
              UI scale
            </label>
            <span className="font-sans text-[13px] text-ink/50">{Math.round(uiScale * 100)}%</span>
          </div>
          <input
            id="ui-scale"
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between font-sans text-[11px] text-ink/40 mt-1">
            <span>{Math.round(UI_SCALE_MIN * 100)}%</span>
            <button className="underline decoration-ink/25 underline-offset-2" onClick={() => setUiScale(1)}>
              Reset
            </button>
            <span>{Math.round(UI_SCALE_MAX * 100)}%</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="font-sans text-[14px] mb-2">UI font</div>
          <div className="grid grid-cols-3 gap-2">
            {UI_FACE_OPTIONS.map((f) => (
              <button
                key={f.id}
                className={`h-9 rounded-field border font-sans text-[13px] ${
                  uiFace === f.id ? 'border-accent bg-accent text-[#FBFAF7]' : 'border-ink/[.22] text-ink/70'
                }`}
                onClick={() => setUiFace(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {user ? (
          <>
            <div className="font-sans text-[13px] text-ink/60 mb-1">Signed in as</div>
            <div className="text-[16px] mb-6">{user.name ? `${user.name} · ${user.email}` : user.email}</div>
            <a
              href={dataApi.exportUrl}
              className="block w-full text-center h-11 leading-[44px] rounded-field border border-ink/[.22] font-sans text-[14px] font-medium mb-3"
            >
              Export my data as JSON
            </a>
            <button
              className="flex items-center justify-center gap-1.5 w-full h-11 rounded-field bg-accent text-[#FBFAF7] font-sans text-[14px] font-medium"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              <LogOut size={15} strokeWidth={1.75} />
              Sign out
            </button>
          </>
        ) : (
          <>
            <div className="font-sans text-[14px] text-ink/60 mb-4">
              Sign in with Google to sync your lists, notes and highlights across devices.
            </div>
            <GoogleSignInButton variant="standard" />
            {authError && <div className="font-sans text-[13px] text-red-600 mt-2">{authError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
