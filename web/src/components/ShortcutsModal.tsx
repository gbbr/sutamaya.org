import type { ThemeColors } from '../lib/types';

interface ShortcutsModalProps {
  // Structural rather than `Shortcut[]`, so the pointer gestures can be appended to the same list;
  // this only ever draws caps and a label.
  shortcuts: Array<{ keys: string[]; label: string }>;
  onClose: () => void;
  // The reader's own theme. The library passes none and takes the shell's ink classes.
  theme?: ThemeColors;
}

// The Shift arrow, drawn rather than typed: the '⇧' character is a hairline outline at cap size in
// the mono face, which all but disappears in the dimmed cap colour.
function ShiftIcon({ px }: { px: number }) {
  return (
    <svg viewBox="0 0 12 12" width={px} height={px} fill="currentColor" aria-hidden="true" focusable="false">
      {/* A narrow stem: much past a third of the head's width it fills the square and stops
          reading as an arrow. */}
      <path d="M6 1 10.8 6.6H8.45V11H3.55V6.6H1.2z" />
    </svg>
  );
}

// One key cap. A `keyName` leading with '⇧' draws the icon above and then the rest, so
// lib/shortcuts.ts can keep writing shortcuts as plain text. `small` is for a cap beside body or
// caption text, which a full-size one would outweigh.
export function KeyCap({ keyName, theme, small }: { keyName: string; theme?: ThemeColors; small?: boolean }) {
  const shift = keyName.startsWith('⇧');
  return (
    <kbd
      // Spelled out, assistive tech otherwise hearing only the bare letter.
      aria-label={shift ? `Shift ${keyName.slice(1)}` : keyName}
      className={`inline-flex items-center justify-center gap-[2px] rounded-md font-mono font-semibold ${
        small ? 'min-w-[18px] h-[18px] px-1 text-[10px] leading-none' : 'min-w-[24px] h-[24px] px-1.5 text-ui-xs'
      } ${theme ? '' : 'border border-ink/20 bg-chip text-ink-2'}`}
      style={theme ? { border: `1px solid ${theme.rule}`, color: theme.dim } : undefined}
    >
      {shift && <ShiftIcon px={small ? 8 : 10} />}
      {shift ? keyName.slice(1) : keyName}
    </kbd>
  );
}

// The "?" keyboard-shortcuts modal, shared by the library and the reader, which differ only in
// whether they pass a theme.
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
