import { X } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

interface DictionaryDockProps {
  word: string;
  gloss: string;
  body: string;
  theme: ThemeColors;
  fontSize: number;
  onClose: () => void;
}

export function DictionaryDock({ word, gloss, body, theme, fontSize, onClose }: DictionaryDockProps) {
  const glossSize = Math.max(11, fontSize - 5.5);
  return (
    <section
      data-component="DictionaryDock"
      className="flex-none animate-sheetUp"
      style={{ borderTop: `2px solid ${theme.fg}`, background: theme.panel, padding: '14px 22px 18px' }}
    >
      <div className="flex items-baseline gap-3">
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
          Close · esc
        </button>
      </div>
      <div
        className="leading-[1.55] mt-[7px] opacity-[.82]"
        style={{ fontSize: Math.max(12, fontSize - 3.5) }}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </section>
  );
}
