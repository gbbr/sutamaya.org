import type { SegmentFile } from '../lib/corpus';
import type { Highlight, ThemeColors } from '../lib/types';

interface SegmentedTextProps {
  segments: SegmentFile[];
  highlights: Highlight[];
  theme: ThemeColors;
  fontSize: number;
  lineHeight: number;
  face: string;
  openSegs: Record<number, boolean>;
  allPali: boolean;
  onToggleSeg: (i: number) => void;
  onWordClick: (word: string) => void;
  onTextUp: () => void;
  onSpanClick: (i: number, s: number, e: number, rect: DOMRect, color: string) => void;
}

interface Part {
  text: string;
  c?: string;
  s?: number;
  e?: number;
}

function buildParts(text: string, hlForSeg: Highlight[]): Part[] {
  const ranges = [...hlForSeg].sort((a, b) => a.s - b.s);
  const parts: Part[] = [];
  let cur = 0;
  ranges.forEach((r) => {
    if (r.s > cur) parts.push({ text: text.slice(cur, r.s) });
    parts.push({ text: text.slice(Math.max(cur, r.s), r.e), c: r.c, s: r.s, e: r.e });
    cur = Math.max(cur, r.e);
  });
  if (cur < text.length) parts.push({ text: text.slice(cur) });
  return parts;
}

export function SegmentedText({
  segments,
  highlights,
  theme,
  fontSize,
  lineHeight,
  face,
  openSegs,
  allPali,
  onToggleSeg,
  onWordClick,
  onTextUp,
  onSpanClick,
}: SegmentedTextProps) {
  return (
    <div onMouseUp={onTextUp} onTouchEnd={onTextUp}>
      {segments.map((seg, i) => {
        const open = allPali || !!openSegs[i];
        const hlForSeg = highlights.filter((h) => h.i === i);
        const parts = buildParts(seg.en, hlForSeg);
        return (
          <div key={seg.key} className="mb-1.5">
            <p
              data-seg={i}
              onClick={() => {
                if (String(window.getSelection())) return;
                onToggleSeg(i);
              }}
              style={{ margin: '0 0 6px', cursor: 'pointer', fontSize, lineHeight: lineHeight / 100, color: theme.fg, fontFamily: face }}
            >
              {parts.map((p, j) =>
                p.c ? (
                  <span
                    key={j}
                    style={{ background: p.c, borderRadius: 2, boxShadow: `0 0 0 2px ${p.c}`, color: '#1B1917' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSpanClick(i, p.s!, p.e!, (e.target as HTMLElement).getBoundingClientRect(), p.c!);
                    }}
                  >
                    {p.text}
                  </span>
                ) : (
                  <span key={j}>{p.text}</span>
                )
              )}
            </p>
            {open && (
              <p
                className="animate-fadeUp"
                style={{ margin: '6px 0 12px', fontSize, lineHeight: lineHeight / 100, fontFamily: face, color: theme.pali }}
              >
                {seg.pali.split(/(\s+)/).map((t, j) =>
                  t.trim() === '' ? (
                    <span key={j}>{t}</span>
                  ) : (
                    <span
                      key={j}
                      className="pw"
                      onClick={(e) => {
                        e.stopPropagation();
                        onWordClick(t);
                      }}
                    >
                      {t}
                    </span>
                  )
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
