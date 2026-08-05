import type { CSSProperties } from 'react';
import type { SegmentFile, SegmentRole } from '../lib/corpus';
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
  // Sujato's own translator notes (SegmentFile.note) — whether the asterisk markers show at all
  // ("c" in the reader, or the Theme tab's checkbox — see ReaderPage/ReaderMenuPanel), and which
  // ones are expanded inline (mirrors openSegs/onToggleSeg's per-segment-index shape).
  showNotes: boolean;
  openNotes: Record<number, boolean>;
  onToggleNote: (i: number) => void;
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

// Per-role style on top of the base English `<p>` style (see SegmentFile.role) — a light,
// legible-but-distinct treatment for each of SuttaCentral's own structural roles, rather than
// every segment reading as identical body prose:
//   - verse: italic, and gets a quoted-block left rule (on the wrapping div, not here — see
//     lastInParagraph below, which the rule reuses to span a whole stanza in one line).
//   - heading: bold and a size up, for a sutta's own internal sub-headings (e.g. DN9's numbered
//     sections) — these already fall on their own paragraph boundary, so no extra margin needed.
//   - end: a closing colophon note ("The Tevijja Sutta is finished") — centered, muted, and a
//     size down, read as a trailing note rather than more body text.
//   - speaker: an inline dialogue attribution embedded mid-verse ("said the Buddha,") — muted,
//     a size down, and deliberately *not* italic, so it stands apart from the verse around it.
function roleStyle(role: SegmentRole | undefined, fontSize: number, theme: ThemeColors): CSSProperties {
  switch (role) {
    case 'verse':
      return { fontStyle: 'italic' };
    case 'heading':
      return { fontWeight: 700, fontSize: fontSize + 3 };
    case 'end':
      return { fontSize: Math.max(11, fontSize - 2), color: theme.dim, fontStyle: 'italic', textAlign: 'center' };
    case 'speaker':
      return { fontSize: Math.max(11, fontSize - 3), color: theme.dim };
    default:
      return {};
  }
}

// Plain-text version of a note for the native `title` attribute (hover) — titles can't render
// the inline HTML (`<i>`/`<em>`/`<b>`/`<span>`) a note may contain, which the click-to-expand
// view below renders properly instead.
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
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
  showNotes,
  openNotes,
  onToggleNote,
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
        // Verse lines get a quoted-block left rule; consecutive verse lines within one stanza
        // sit flush against each other (0 gap, same as prose within a paragraph — see above) so
        // the rule reads as one continuous line down the whole stanza, only breaking at a real
        // stanza/paragraph gap.
        return (
          <div
            key={seg.key}
            id={seg.key}
            style={{
              marginBottom: lastInParagraph ? paragraphGap : 0,
              ...(seg.role === 'verse' ? { paddingLeft: 14, borderLeft: `2px solid ${theme.rule}` } : null),
            }}
          >
            <p
              data-seg={i}
              onClick={() => {
                if (String(window.getSelection())) return;
                onToggleSeg(i);
              }}
              style={{
                margin: 0,
                cursor: 'pointer',
                fontSize,
                lineHeight: lineHeight / 100,
                color: theme.fg,
                fontFamily: face,
                ...roleStyle(seg.role, fontSize, theme),
              }}
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
              {seg.note && showNotes && (
                <sup
                  style={{ marginLeft: 2, color: theme.dim, fontStyle: 'normal', fontWeight: 700, cursor: 'pointer' }}
                  title={stripTags(seg.note)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleNote(i);
                  }}
                >
                  *
                </sup>
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
            {showNotes && seg.note && openNotes[i] && (
              <p
                className="animate-fadeUp"
                style={{ margin: '6px 0 0', fontSize: Math.max(11, fontSize - 3), lineHeight: 1.5, fontFamily: face, color: theme.dim }}
                // Notes are static, build-time-controlled data (see build-corpus.mjs's
                // cleanNote()) carrying inline `<i>`/`<em>`/`<b>`/`<span>` formatting — not
                // user/runtime content, so rendering the markup here is the same trust level as
                // rendering the sutta text itself.
                dangerouslySetInnerHTML={{ __html: seg.note }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
