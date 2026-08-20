import { useLayoutEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS } from '../lib/theme';
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
        className="fixed left-0 right-0 bottom-0 z-[60] flex items-center gap-2 px-4 pt-[10px] animate-sheetUp"
        style={{
          background: theme.panel,
          color: theme.fg,
          borderTop: `1px solid ${theme.rule}`,
          paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        }}
        onPointerDown={onStop}
        onPointerUp={onStop}
        onMouseUp={onStop}
      >
        <div className="flex-1 flex items-center gap-3">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              className="w-11 h-9 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                onPick(c);
              }}
            >
              <span
                className="w-[26px] h-[26px] rounded-full border"
                style={{ background: c, borderColor: pop.on === c ? theme.fg : 'rgba(0,0,0,.22)' }}
              />
            </button>
          ))}
        </div>
        {pop.on && (
          <button
            className="flex items-center gap-1 font-sans text-xs opacity-65 h-9 px-2"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            Remove
          </button>
        )}
        <button
          aria-label="Close"
          className="w-9 h-9 flex items-center justify-center opacity-55"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={17} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

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
