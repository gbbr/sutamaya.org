import { useLayoutEffect, useRef } from 'react';
import { HIGHLIGHT_COLORS } from '../lib/theme';
import type { ThemeColors } from '../lib/types';
import type { PopState } from '../hooks/useHighlightPopup';

interface HighlightPopupProps {
  pop: PopState;
  theme: ThemeColors;
  onPick: (color: string | null) => void;
  onRemove: () => void;
  onNote: () => void;
  onStop: (e: React.SyntheticEvent) => void;
}

export function HighlightPopup({ pop, theme, onPick, onRemove, onNote, onStop }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = 'translate(-50%,-100%)';
    el.style.marginTop = '-10px';
    el.style.left = `${pop.x}px`;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > window.innerWidth - 10) dx = window.innerWidth - 10 - r.right;
    if (r.left + dx < 10) dx = 10 - (r.left + dx);
    if (dx) el.style.left = `${pop.x + dx}px`;
    if (r.top < 10) {
      el.style.transform = 'translate(-50%,0)';
      el.style.marginTop = '10px';
    }
  }, [pop]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] flex items-center gap-[9px] px-[11px] py-[7px] rounded-chip shadow-popup animate-popIn"
      style={{ left: pop.x, top: pop.y, background: theme.panel, border: `1px solid ${theme.rule}` }}
      onPointerDown={onStop}
      onPointerUp={onStop}
      onMouseUp={onStop}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className="w-5 h-5 rounded-full border"
          style={{ background: c, borderColor: pop.on === c ? theme.fg : 'rgba(0,0,0,.22)' }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(c);
          }}
        />
      ))}
      {pop.on && (
        <button
          className="font-sans text-xs opacity-65 px-[3px]"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          Remove
        </button>
      )}
      <button
        className="font-sans text-xs opacity-65 px-[3px]"
        onClick={(e) => {
          e.stopPropagation();
          onNote();
        }}
      >
        Note
      </button>
    </div>
  );
}
