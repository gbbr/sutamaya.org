import { useLayoutEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { HIGHLIGHT_COLORS } from '../lib/theme';
import { getUiScale } from '../lib/uiPrefs';
import type { ThemeColors } from '../lib/types';
import type { PopState } from '../hooks/useHighlightPopup';

interface HighlightPopupProps {
  pop: PopState;
  theme: ThemeColors;
  onPick: (color: string | null) => void;
  onRemove: () => void;
  onStop: (e: React.SyntheticEvent) => void;
}

export function HighlightPopup({ pop, theme, onPick, onRemove, onStop }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `pop.x`/`pop.y` are real screen-space coordinates (from getClientRects on the selection),
    // but this element renders inside the `zoom`-scaled <html> (see applyUiScale) — a CSS length
    // assigned here gets multiplied by that zoom again at paint time, so it has to be
    // pre-divided by the same scale to land at the intended screen position (same reasoning as
    // index.css's 100dvh compensation).
    const scale = getUiScale();
    // Below by default — `pop.y` is the bottom edge of the line the selection ends on, and
    // showing the picker above it would sit under (or fight with) the OS's own selection menu
    // on mobile. Only flips back above if there's no room below the viewport.
    el.style.transform = 'translate(-50%,0)';
    el.style.marginTop = '10px';
    el.style.left = `${pop.x / scale}px`;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > window.innerWidth - 10) dx = window.innerWidth - 10 - r.right;
    if (r.left + dx < 10) dx = 10 - (r.left + dx);
    if (dx) el.style.left = `${(pop.x + dx) / scale}px`;
    if (r.bottom > window.innerHeight - 10) {
      el.style.transform = 'translate(-50%,-100%)';
      el.style.marginTop = '-10px';
    }
  }, [pop]);

  return (
    <div
      ref={ref}
      data-component="HighlightPopup"
      className="fixed z-[60] flex items-center gap-[9px] px-[11px] py-[7px] rounded-chip shadow-popup animate-popIn"
      style={{ left: pop.x / getUiScale(), top: pop.y / getUiScale(), background: theme.panel, border: `1px solid ${theme.rule}` }}
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
          className="flex items-center gap-1 font-sans text-xs opacity-65 px-[3px]"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} strokeWidth={1.75} />
          Remove
        </button>
      )}
    </div>
  );
}
