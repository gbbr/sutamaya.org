import { X } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

interface DictionaryDockProps {
  word: string;
  gloss: string;
  defs: string[] | null;
  theme: ThemeColors;
  fontSize: number;
  onClose: () => void;
}

export function DictionaryDock({ word, gloss, defs, theme, fontSize, onClose }: DictionaryDockProps) {
  const glossSize = Math.max(11, fontSize - 5.5);
  const defSize = Math.max(12, fontSize - 3.5);
  const numbered = !!defs && defs.length > 1;
  return (
    <section
      data-component="DictionaryDock"
      className="flex-none flex flex-col animate-sheetUp"
      style={{ borderTop: `2px solid ${theme.fg}`, background: theme.panel, padding: '14px 22px 18px', maxHeight: '45vh' }}
    >
      <div className="flex-none flex items-baseline gap-3">
        <div className="font-semibold font-serif" style={{ fontSize: fontSize + 2 }}>{word}</div>
        <div className="font-sans flex-1 opacity-55" style={{ fontSize: glossSize }}>{gloss}</div>
        <button
          className="flex items-center gap-1 font-sans opacity-60"
          style={{ fontSize: glossSize }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={13} strokeWidth={1.75} />
          Close
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[9px] mt-[7px] opacity-[.82]" style={{ fontSize: defSize }}>
        {defs && defs.length > 0 ? (
          defs.map((entry, i) => (
            <div key={i} className="flex items-baseline gap-[8px] leading-[1.55]">
              {numbered && (
                <span
                  className="flex-none inline-block text-center rounded-full font-sans font-bold"
                  style={{
                    width: Math.round(defSize + 3),
                    height: Math.round(defSize + 3),
                    fontSize: Math.round(defSize - 4),
                    lineHeight: `${Math.round(defSize + 3)}px`,
                    color: theme.panel,
                    background: theme.fg,
                    opacity: 0.38,
                  }}
                >
                  <span style={{ display: 'inline-block', transform: 'translateY(0.08em)' }}>{i + 1}</span>
                </span>
              )}
              <span dangerouslySetInnerHTML={{ __html: entry }} />
            </div>
          ))
        ) : (
          <div className="leading-[1.55]">
            No entry in the offline dictionary for this form. Try the stem, or search the full lexicon.
          </div>
        )}
      </div>
    </section>
  );
}
