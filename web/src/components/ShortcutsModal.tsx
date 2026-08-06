import type { Shortcut } from '../lib/shortcuts';

interface ShortcutsModalProps {
  shortcuts: Shortcut[];
  onClose: () => void;
}

// The Library-scope ("?") help modal — styled with the app-shell's own Tailwind tokens, matching
// TreePane/ListPane, rather than a reader `theme` object (see ReaderShortcutsModal for that
// side's equivalent). Both render the same `Shortcut[]` from lib/shortcuts.ts.
export function ShortcutsModal({ shortcuts, onClose }: ShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div
        data-component="ShortcutsModal"
        className="w-full mx-4 rounded-sheet shadow-popup bg-paper border border-ink/10 overflow-hidden animate-fadeUp"
        style={{ maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-ink/10">
          <div className="font-sans text-[15px] font-semibold">Keyboard shortcuts</div>
          <button className="font-sans text-[13px] text-ink/50 hover:text-ink/70" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </header>
        <ul className="py-2">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 px-5 py-2">
              <span className="font-sans text-[13.5px] text-ink/75">{s.label}</span>
              <span className="flex items-center gap-1 flex-none">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded-md border border-ink/20 bg-chip font-mono text-[11px] font-semibold text-ink/70"
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
