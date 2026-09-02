import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

interface DictionaryDockProps {
  word: string;
  gloss: string;
  defs: string[] | null;
  loading?: boolean;
  // True once every attempt at the background-loaded dictionary has failed, which the dock's
  // `loading` copy would otherwise be indistinguishable from.
  dictionaryFailed?: boolean;
  theme: ThemeColors;
  fontSize: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRetryDictionary: () => void;
}

export function DictionaryDock({
  word,
  gloss,
  defs,
  loading,
  dictionaryFailed,
  theme,
  fontSize,
  onClose,
  onPrev,
  onNext,
  onRetryDictionary,
}: DictionaryDockProps) {
  const glossSize = Math.max(11, fontSize - 5.5);
  const defSize = Math.max(12, fontSize - 3.5);
  const numbered = !!defs && defs.length > 1;
  return (
    <section
      data-component="DictionaryDock"
      className="flex-none flex flex-col animate-sheetUp"
      style={{
        borderTop: `2px solid ${theme.fg}`,
        background: theme.panel,
        padding: '14px 22px 18px',
        maxHeight: '45dvh',
      }}
    >
      <div className="flex-none flex items-baseline gap-3">
        <div className="font-semibold font-serif min-w-0 truncate" style={{ fontSize: fontSize + 2 }}>{word}</div>
        <div className="font-sans flex-1 opacity-55" style={{ fontSize: glossSize }}>{gloss}</div>
        <button
          aria-label="Previous word"
          title="Previous word"
          className="flex items-center opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        >
          <ChevronLeft size={19} strokeWidth={1.75} />
        </button>
        <button
          aria-label="Next word"
          title="Next word"
          className="flex items-center opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        >
          <ChevronRight size={19} strokeWidth={1.75} />
        </button>
        <button
          aria-label="Close"
          title="Close"
          className="flex items-center opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={19} strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[9px] mt-[7px] opacity-[.82]" style={{ fontSize: defSize }}>
        {loading && dictionaryFailed ? (
          <div className="leading-[1.55] flex items-baseline gap-[10px]">
            <span className="opacity-70">Couldn't download the dictionary.</span>
            <button
              className="font-sans underline underline-offset-2"
              onClick={(e) => {
                e.stopPropagation();
                onRetryDictionary();
              }}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="leading-[1.55] opacity-70">Loading dictionary…</div>
        ) : defs && defs.length > 0 ? (
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
