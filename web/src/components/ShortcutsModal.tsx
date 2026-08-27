import type { ThemeColors } from '../lib/types';

interface ShortcutsModalProps {
  // Structural, not `Shortcut[]`, so a caller can append the pointer gestures (lib/shortcuts'
  // POINTER_HINTS) to the same list — this only ever renders a cap row and a label.
  shortcuts: Array<{ keys: string[]; label: string }>;
  onClose: () => void;
  // Present only from the Reader, which has its own light/sepia/dark theme independent of the app
  // shell's. LibraryPage's "?" passes no theme and gets the app-shell Tailwind `ink` classes.
  theme?: ThemeColors;
}

// The Shift key, drawn rather than typed. The '⇧' character renders as a hairline outline at cap
// size in the mono face, which all but disappears against the dimmed cap colour; a filled arrow
// reads at a glance.
function ShiftIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true" focusable="false">
      {/* The stem is kept narrow against the head — at cap size a stem much wider than a third of
          the head fills the square and stops reading as an arrow. */}
      <path d="M6 1 10.8 6.6H8.45V11H3.55V6.6H1.2z" />
    </svg>
  );
}

// One key cap. A `keyName` leading with '⇧' draws the icon above followed by the rest of the label,
// so lib/shortcuts.ts keeps writing the shortcut as plain text. `theme` styles it from the reader's
// palette; without one it uses the app-shell ink tokens.
export function KeyCap({ keyName, theme }: { keyName: string; theme?: ThemeColors }) {
  const shift = keyName.startsWith('⇧');
  return (
    <kbd
      // Spelled out for assistive tech, which would otherwise hear only the bare letter.
      aria-label={shift ? `Shift ${keyName.slice(1)}` : keyName}
      className={`inline-flex items-center justify-center gap-[2px] min-w-[24px] h-[24px] px-1.5 rounded-md font-mono text-ui-xs font-semibold ${
        theme ? '' : 'border border-ink/20 bg-chip text-ink-2'
      }`}
      style={theme ? { border: `1px solid ${theme.rule}`, color: theme.dim } : undefined}
    >
      {shift && <ShiftIcon />}
      {shift ? keyName.slice(1) : keyName}
    </kbd>
  );
}

// The "?" keyboard-shortcuts help modal, shared by LibraryPage and ReaderPage: both render the same
// `Shortcut[]` from lib/shortcuts.ts through one overlay/header/list/<kbd> structure. Only the
// styling differs — Tailwind `ink` tokens when no `theme` is passed, inline `theme.*` when one is.
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
            className={`font-sans text-ui-base ${theme ? '' : 'text-ink-4 hover:text-ink-2'}`}
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
              <span className={`font-sans text-ui-base ${theme ? '' : 'text-ink-2'}`} style={theme ? { color: theme.fg } : undefined}>
                {s.label}
              </span>
              <span className="flex items-center gap-1 flex-none">
                {s.keys.map((k) => (
                  <KeyCap key={k} keyName={k} theme={theme} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
