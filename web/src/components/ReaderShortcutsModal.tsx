import type { Shortcut } from '../lib/shortcuts';
import type { ThemeColors } from '../lib/types';

interface ReaderShortcutsModalProps {
  shortcuts: Shortcut[];
  theme: ThemeColors;
  onClose: () => void;
}

// The Reader-scope ("?") help modal — styled from the reader's own `theme` object, matching
// ReaderSearchOverlay/ListMembershipPicker, rather than the app-shell's Tailwind tokens (see
// ShortcutsModal for that side's equivalent). Both render the same `Shortcut[]` from
// lib/shortcuts.ts.
export function ReaderShortcutsModal({ shortcuts, theme, onClose }: ReaderShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div
        data-component="ReaderShortcutsModal"
        className="w-full mx-4 rounded-2xl shadow-popup overflow-hidden animate-fadeUp"
        style={{ background: theme.panel, maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${theme.rule}` }}>
          <div className="font-sans text-[15px] font-semibold" style={{ color: theme.fg }}>
            Keyboard shortcuts
          </div>
          <button className="font-sans text-[13px]" style={{ color: theme.dim }} onClick={onClose} aria-label="Close">
            Esc
          </button>
        </header>
        <ul className="py-2">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 px-5 py-2">
              <span className="font-sans text-[13.5px]" style={{ color: theme.fg }}>
                {s.label}
              </span>
              <span className="flex items-center gap-1 flex-none">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded-md font-mono text-[11px] font-semibold"
                    style={{ border: `1px solid ${theme.rule}`, color: theme.dim }}
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
