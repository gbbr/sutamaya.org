import { X } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

interface DictionaryDockProps {
  word: string;
  gloss: string;
  body: string;
  theme: ThemeColors;
  onClose: () => void;
}

export function DictionaryDock({ word, gloss, body, theme, onClose }: DictionaryDockProps) {
  return (
    <section
      className="flex-none animate-sheetUp"
      style={{ borderTop: `2px solid ${theme.fg}`, background: theme.panel, padding: '14px 22px 18px' }}
    >
      <div className="flex items-baseline gap-3">
        <div className="text-[20px] font-semibold font-serif">{word}</div>
        <div className="font-sans flex-1 text-[12.5px] opacity-55">{gloss}</div>
        <button
          className="flex items-center gap-1 font-sans text-[12.5px] opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={13} strokeWidth={1.75} />
          Close · esc
        </button>
      </div>
      <div className="text-[14.5px] leading-[1.55] mt-[7px] opacity-[.82]" dangerouslySetInnerHTML={{ __html: body }} />
    </section>
  );
}
