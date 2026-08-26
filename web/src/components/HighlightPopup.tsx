import { useLayoutEffect, useRef } from 'react';
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

// Marks the swatch of the currently applied color. The ring sits *outside* the swatch, held off it
// by a 1px band of the popup's own background, rather than being painted onto the swatch's border:
// the swatches are the same pale pastels in every theme, so a rim drawn on the edge has to clear
// both them and the panel behind, which no single color does — dark's cream `fg` sinks into the
// pastel, an ink rim sinks into dark's brown panel. Held off the swatch, the ring only ever has the
// panel to clear, so `fg` reads in all three themes.
// Every swatch carries a hairline; the applied one's is brought up from `rule` to `dim`. That works
// because a swatch is painted in its theme's own fill (highlightPaint), so it always contrasts with
// the panel it sits on and a line between the two is visible in any theme. `dim` rather than `fg`
// keeps it from reading louder than the "Remove" label beside it, drawn at 65%.
const swatchBorder = (theme: ThemeColors, selected: boolean) => (selected ? theme.dim : theme.rule);

export function HighlightPopup({ pop, theme, mobile, onPick, onRemove, onClose, onStop }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    // `pop.x`/`pop.y` are real screen-space coordinates (from getClientRects on the selection),
    // but this element renders inside the `zoom`-scaled <html> (see applyUiScale) — a CSS length
    // assigned here gets multiplied by that zoom again at paint time, so it has to be
    // pre-divided by the same scale to land at the intended screen position (same reasoning as
    // index.css's 100dvh compensation).
    const scale = getUiScale();
    // Below by default — `pop.y` is the bottom edge of the line the selection ends on, so the
    // picker sits clear of the text just selected. Only flips above if there's no room below the
    // viewport.
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
  }, [pop, mobile]);

  // On a touch device the OS puts its own selection menu ("Copy | Look Up | …") next to the
  // selection and there is no way to suppress it, so anything anchored there gets covered. The
  // picker moves to a bar pinned along the bottom edge instead, well clear of both the menu and
  // the finger that made the selection. Dismissed by tapping the text (ReaderPage's tap handler)
  // or by its own close button, since a full-width bar reads as more permanent than a popup.
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
      style={{ left: pop.x / getUiScale(), top: pop.y / getUiScale(), background: theme.panel, border: `1px solid ${theme.rule}` }}
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
