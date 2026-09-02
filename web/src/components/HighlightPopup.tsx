import { useLayoutEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, highlightPaint } from '../lib/theme';
import { getUiScale } from '../lib/uiPrefs';
import type { ThemeColors } from '../lib/types';
import type { PopState } from '../hooks/useHighlightPopup';

interface HighlightPopupProps {
  pop: PopState;
  theme: ThemeColors;
  mobile: boolean;
  onPick: (color: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
  onStop: (e: React.SyntheticEvent) => void;
}

// swatchBorder returns a swatch's hairline colour: `dim` on the applied colour, `rule` otherwise.
const swatchBorder = (theme: ThemeColors, selected: boolean) => (selected ? theme.dim : theme.rule);

// The gap the popup keeps from the selection.
const GAP = 10;
// The margin it keeps from the viewport's edges.
const EDGE = 10;

export function HighlightPopup({ pop, theme, mobile, onPick, onRemove, onClose, onStop }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Where the popup goes, or null before the first measurement.
  const [place, setPlace] = useState<{ above: boolean; dx: number } | null>(null);

  // Places the popup from its own measured size and the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    // Screen-space throughout, as `pop` is; the division back into CSS pixels happens in the style.
    const { width, height } = el.getBoundingClientRect();
    const half = width / 2;
    let dx = 0;
    if (pop.x + half > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - (pop.x + half);
    if (pop.x - half + dx < EDGE) dx = EDGE - (pop.x - half);
    setPlace({ above: pop.top - height - GAP >= EDGE, dx });
  }, [pop, mobile]);

  // Above the selection unless it sits too near the top of the viewport to fit.
  const above = place?.above ?? true;

  // On touch, a full-width bar pinned along the bottom edge, with its own close button.
  if (mobile) {
    return (
      <div
        ref={ref}
        data-component="HighlightPopup"
        className="fixed left-0 right-0 bottom-0 z-[60] flex items-center gap-[10px] px-5 pt-[13px] animate-sheetUp"
        style={{
          background: theme.panel,
          color: theme.fg,
          borderTop: `1px solid ${theme.rule}`,
          paddingBottom: 'calc(13px + env(safe-area-inset-bottom, 0px))',
        }}
        onPointerDown={onStop}
        onPointerUp={onStop}
        onMouseUp={onStop}
      >
        <div className="flex-1 flex items-center gap-[15px]">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              className="w-[55px] h-[45px] flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                onPick(c);
              }}
            >
              <span
                className="w-[33px] h-[33px] rounded-full border"
                style={{ background: highlightPaint(c, theme), borderColor: swatchBorder(theme, pop.on === c) }}
              />
            </button>
          ))}
        </div>
        {pop.on && (
          <button
            className="flex items-center gap-[5px] font-sans text-ui-sm opacity-65 h-[45px] px-2.5"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 size={21} strokeWidth={1.75} />
            Remove
          </button>
        )}
        <button
          aria-label="Close"
          className="w-[45px] h-[45px] flex items-center justify-center opacity-55"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={26} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-component="HighlightPopup"
      className="fixed z-[60] flex items-center gap-[11px] px-[14px] py-[9px] rounded-chip shadow-popup animate-popIn"
      style={{
        left: (pop.x + (place?.dx ?? 0)) / getUiScale(),
        top: (above ? pop.top : pop.bottom) / getUiScale(),
        transform: above ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
        marginTop: above ? -GAP : GAP,
        background: theme.panel,
        border: `1px solid ${theme.rule}`,
      }}
      onPointerDown={onStop}
      onPointerUp={onStop}
      onMouseUp={onStop}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className="w-[25px] h-[25px] rounded-full border"
          style={{ background: highlightPaint(c, theme), borderColor: swatchBorder(theme, pop.on === c) }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(c);
          }}
        />
      ))}
      {pop.on && (
        <button
          className="flex items-center gap-[5px] font-sans text-ui-sm opacity-65 px-1"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={20} strokeWidth={1.75} />
          Remove
        </button>
      )}
    </div>
  );
}
