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

// A segment key is "{uid}:{paragraph}.{sub...}" (e.g. "an8.70:3.7.0" is paragraph 3) — the digit
// group right after the colon and before the first '.' is the paragraph number shared by every
// segment within it, regardless of how deep the rest of the key nests.
function paragraphOf(key: string): string {
  return key.split(':').pop()!.split('.')[0];
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
  // Space between paragraphs — scales with both the Size and Line height reader controls (not a
  // fixed pixel value), so turning either up also opens up more room between paragraphs instead
  // of just within them. 0.6x a full computed line height reads as a clear paragraph break
  // without the gap dominating the page the way a full line height did.
  const paragraphGap = Math.round((fontSize * lineHeight * 0.6) / 100);
  return (
    <div data-component="SegmentedText" data-segroot onMouseUp={onTextUp} onTouchEnd={onTextUp}>
      {segments.map((seg, i) => {
        const open = allPali || !!openSegs[i];
        const hlForSeg = highlights.filter((h) => h.i === i);
        const parts = buildParts(seg.en, hlForSeg);
        // No gap at all between segments within the same paragraph (the English `<p>` below has
        // no margin of its own either, so there's nothing left to collapse into a visible gap) —
        // only a real paragraph break (the next segment's paragraph number differs from this
        // one's) gets space, so same-paragraph segments read as one continuous block of text.
        const next = segments[i + 1];
        const lastInParagraph = !next || paragraphOf(next.key) !== paragraphOf(seg.key);
        return (
          <div key={seg.key} id={seg.key} style={{ marginBottom: lastInParagraph ? paragraphGap : 0 }}>
            <p
              data-seg={i}
              onClick={() => {
                if (String(window.getSelection())) return;
                onToggleSeg(i);
              }}
              style={{ margin: 0, cursor: 'pointer', fontSize, lineHeight: lineHeight / 100, color: theme.fg, fontFamily: face }}
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
