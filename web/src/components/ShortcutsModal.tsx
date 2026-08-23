import type { Shortcut } from '../lib/shortcuts';
import type { ThemeColors } from '../lib/types';

interface ShortcutsModalProps {
  shortcuts: Shortcut[];
  onClose: () => void;
  // Present only from the Reader ("?" there uses `shortcutsForScope('reader')`) — the reader has
  // its own light/sepia/dark theme system, independent of the app shell's own dark/light mode
  // (see SuttaRowChips for the same split, and its own comment on why). LibraryPage's own "?"
  // passes no theme and gets the app-shell Tailwind `ink` classes instead.
  theme?: ThemeColors;
}

// The "?" keyboard-shortcuts help modal, shared by LibraryPage (app-shell themed) and ReaderPage
// (reader-themed) — both render the same `Shortcut[]` from lib/shortcuts.ts through one
// overlay/header/list/<kbd> structure. The only difference is how it's styled: Tailwind `ink`
// tokens when no `theme` is passed, inline `theme.*` styles when one is.
export function ShortcutsModal({ shortcuts, onClose, theme }: ShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div
        data-component="ShortcutsModal"
        className={`w-full mx-4 shadow-popup overflow-hidden animate-fadeUp ${theme ? 'rounded-2xl' : 'rounded-sheet bg-paper border border-ink/10'}`}
        style={{ background: theme?.panel, maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className={`flex items-center justify-between px-5 py-4 ${theme ? '' : 'border-b border-ink/10'}`}
          style={theme ? { borderBottom: `1px solid ${theme.rule}` } : undefined}
        >
          <div className="font-sans text-ui-lg font-semibold" style={theme ? { color: theme.fg } : undefined}>
            Keyboard shortcuts
          </div>
          <button
            className={`font-sans text-ui-base ${theme ? '' : 'text-ink/50 hover:text-ink/70'}`}
            style={theme ? { color: theme.dim } : undefined}
            onClick={onClose}
            aria-label="Close"
          >
            Esc
          </button>
        </header>
        <ul className="py-2">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 px-5 py-2">
              <span className={`font-sans text-ui-base ${theme ? '' : 'text-ink/75'}`} style={theme ? { color: theme.fg } : undefined}>
                {s.label}
              </span>
              <span className="flex items-center gap-1 flex-none">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className={`inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-md font-mono text-ui-xs font-semibold ${
                      theme ? '' : 'border border-ink/20 bg-chip text-ink/70'
                    }`}
                    style={theme ? { border: `1px solid ${theme.rule}`, color: theme.dim } : undefined}
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
