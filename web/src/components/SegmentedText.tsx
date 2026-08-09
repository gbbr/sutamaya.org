import { memo, useMemo, type CSSProperties } from 'react';
import type { SegmentFile, SegmentRole } from '../lib/corpus';
import type { Highlight, ThemeColors } from '../lib/types';
import { highlightPaint } from '../lib/theme';
import { WORD_BOUNDARY, isWordBoundary } from '../lib/dictionary';

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
//     sections). A heading's key shares its paragraph number with the body text right after it
//     (e.g. "6.0" the heading, "6.1"/"6.2"/… its paragraph), so the wrapping div's own "no gap
//     within a paragraph" margin never fires for it — the heading element gets its own top/bottom
//     margin instead (below, in the JSX), more above than below like a normal heading.
//     An <h3> (nested under an <h2> — see SegmentFile.headingLevel) steps down from the <h2>
//     size rather than matching it, so the two actually read as a hierarchy.
//   - end: a closing colophon note ("The Tevijja Sutta is finished") — centered, muted, and a
//     size down, read as a trailing note rather than more body text.
//   - speaker: an inline dialogue attribution embedded mid-verse ("said the Buddha,") — muted,
//     a size down, and deliberately *not* italic, so it stands apart from the verse around it.
function roleStyle(
  role: SegmentRole | undefined,
  fontSize: number,
  theme: ThemeColors,
  headingLevel?: 2 | 3
): CSSProperties {
  switch (role) {
    case 'verse':
      return { fontStyle: 'normal' };
    case 'heading':
      return { fontWeight: 700, fontSize: fontSize + (headingLevel === 3 ? 1 : 3) };
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

interface SegmentRowProps {
  seg: SegmentFile;
  i: number;
  hlForSeg: Highlight[];
  open: boolean;
  lastInParagraph: boolean;
  theme: ThemeColors;
  fontSize: number;
  lineHeight: number;
  face: string;
  paragraphGap: number;
  onToggleSeg: (i: number) => void;
  // wordIndex is the tapped word's position among this segment's own Pali tokens (see
  // lib/dictionary.ts's splitPaliWords) — lets ReaderPage step to the prev/next word from
  // wherever the DictionaryDock's own arrows are clicked, without re-deriving it from the raw
  // word text (which isn't unique within a segment).
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onSpanClick: (i: number, s: number, e: number, rect: DOMRect, color: string) => void;
  showNotes: boolean;
  noteOpen: boolean;
  onToggleNote: (i: number) => void;
  // The word index (within *this* segment) currently shown in the DictionaryDock, or null if
  // this segment isn't the active one — a plain nullable number rather than the full {segIndex,
  // wordIndex} pair so an unrelated segment's own SegmentRow keeps seeing `null` before and after
  // a click elsewhere, and its `memo` bails instead of re-rendering (see the perf note below).
  activeWordIndex: number | null;
}

// One sutta segment (a paragraph/verse-line/heading/etc — see SegmentFile). Memoized so that
// toggling a single segment's Pali reveal or note, or changing highlights elsewhere in the
// sutta, only re-renders the row(s) whose own props actually changed rather than the whole
// (potentially 1000+ segment) list — see the perf note on SegmentedText below.
const SegmentRow = memo(function SegmentRow({
  seg,
  i,
  hlForSeg,
  open,
  lastInParagraph,
  theme,
  fontSize,
  lineHeight,
  face,
  paragraphGap,
  onToggleSeg,
  onWordClick,
  onSpanClick,
  showNotes,
  noteOpen,
  onToggleNote,
  activeWordIndex,
}: SegmentRowProps) {
  const parts = buildParts(seg.en, hlForSeg);
  // A structural sub-heading (SuttaCentral's own <h2>/<h3> nesting — see build-corpus.mjs's
  // roleFor()) renders as a real heading element, not a styled <p>, and picks up the UI's sans
  // font (like the reader's chrome) rather than the reading face — it's document structure, not
  // body prose.
  const HeadingTag: 'h2' | 'h3' | 'p' = seg.role === 'heading' ? (seg.headingLevel === 3 ? 'h3' : 'h2') : 'p';
  return (
    <div
      id={seg.key}
      style={{
        marginBottom: lastInParagraph ? paragraphGap : 0,
        ...(seg.role === 'verse' ? { paddingLeft: 14, borderLeft: `2px solid ${theme.rule}` } : null),
      }}
    >
      <HeadingTag
        data-seg={i}
        className={seg.role === 'heading' ? 'font-sans' : undefined}
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
          ...(seg.role === 'heading' ? null : { fontFamily: face }),
          ...roleStyle(seg.role, fontSize, theme, seg.headingLevel),
          ...(seg.role === 'heading' ? { marginTop: paragraphGap, marginBottom: Math.round(paragraphGap / 2) } : null),
        }}
      >
        {parts.map((p, j) =>
          p.c ? (
            <span
              key={j}
              // Deliberately no user-select:none here, unlike `.pw`/the note asterisk below —
              // this span sits inside the same selectable English prose the highlight-selection
              // feature drags across (including dragging *through* an existing highlight to
              // extend/merge it), so suppressing selection on it would break that drag mid-gesture.
              // Text color switches to theme.fg once the paint itself dims below opaque (dark
              // theme) — the hardcoded near-black otherwise assumes an opaque pastel background,
              // which no longer holds once that background is alpha-composited over a dark page.
              style={{
                background: highlightPaint(p.c, theme),
                borderRadius: 2,
                boxShadow: `0 0 0 2px ${highlightPaint(p.c, theme)}`,
                color: theme.highlightAlpha < 1 ? theme.fg : '#1B1917',
              }}
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
            // padding (rather than just a bigger glyph) is what actually grows the tap target —
            // a bare `<sup>*</sup>` hit-tests to its own tiny painted glyph, which is what made
            // it fiddly to hit on a touch screen. Vertical padding on an inline, non-replaced
            // element doesn't affect line-height, so it's free; the horizontal padding does add a
            // little real space in the line, which is fine since this always sits at the end of
            // the paragraph with nothing after it to crowd. `verticalAlign`/`top` replace the
            // browser default `sup` super-raise (which sat the asterisk high enough to nearly
            // touch the line above) with a smaller, fixed raise instead — a conventional
            // footnote-marker position just above the baseline, not a full superscript and not
            // sitting on the line itself.
            style={{
              marginLeft: 2,
              padding: '8px 8px 8px 4px',
              color: theme.pali,
              fontStyle: 'normal',
              fontWeight: 700,
              fontSize: '0.85em',
              verticalAlign: 'baseline',
              position: 'relative',
              top: '-0.4em',
              cursor: 'pointer',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            title={stripTags(seg.note)}
            onClick={(e) => {
              e.stopPropagation();
              onToggleNote(i);
            }}
          >
            *
          </sup>
        )}
      </HeadingTag>
      {open && (
        <p
          className="animate-fadeUp"
          // --pw-hover backs .pw:hover (index.css) — theme.tint rather than a fixed color, so a
          // tapped/hovered Pali word's highlight stays a subtle wash against theme.pali's own
          // text color instead of a hardcoded light tan that read as near-invisible against the
          // dark theme's own gold Pali color.
          style={
            {
              margin: '6px 0 12px',
              fontSize,
              lineHeight: lineHeight / 100,
              fontFamily: face,
              color: theme.pali,
              '--pw-hover': theme.tint,
            } as CSSProperties
          }
        >
          {(() => {
            let wordIndex = -1;
            // Splits on whitespace *and* a bare "—" (see lib/dictionary.ts's WORD_BOUNDARY) — the
            // dash itself still renders (it's real text, e.g. joining two words with no space
            // between them), just as an inert span like whitespace, not a clickable/lookup-able
            // word of its own.
            return seg.pali.split(WORD_BOUNDARY).map((t, j) => {
              if (isWordBoundary(t)) return <span key={j}>{t}</span>;
              const w = ++wordIndex;
              // Driven by real state (the word currently shown in the DictionaryDock), not by
              // :hover — :hover alone used to be the only "this word is active" cue, which only
              // ever reliably stuck around on iOS Safari's tap-lingers-as-hover quirk; it doesn't
              // survive at all once the dock's own prev/next arrows move the lookup to a word the
              // pointer was never actually over.
              const isActive = w === activeWordIndex;
              return (
                <span
                  key={j}
                  className="pw"
                  // Distinct attribute names from the ancestor heading's own `data-seg` (used by
                  // scrollToSegment) — lets ReaderPage's scrollToWordIfCovered locate *this*
                  // specific word's DOM rect (to check whether it's actually hidden) without
                  // colliding with that existing per-segment query.
                  data-word-seg={i}
                  data-word={w}
                  style={isActive ? { background: theme.tint } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onWordClick(t, i, w);
                  }}
                >
                  {t}
                </span>
              );
            });
          })()}
        </p>
      )}
      {showNotes && seg.note && noteOpen && (
        <p
          className="animate-fadeUp"
          style={{ margin: '0 0 6px', fontSize: Math.max(11, fontSize - 3), lineHeight: 1.5, fontFamily: face, color: theme.dim }}
          // Notes are static, build-time-controlled data (see build-corpus.mjs's
          // cleanNote()) carrying inline `<i>`/`<em>`/`<b>`/`<span>` formatting — not
          // user/runtime content, so rendering the markup here is the same trust level as
          // rendering the sutta text itself.
          dangerouslySetInnerHTML={{ __html: seg.note }}
        />
      )}
    </div>
  );
});

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
  // wordIndex is the tapped word's position among this segment's own Pali tokens (see
  // lib/dictionary.ts's splitPaliWords) — lets ReaderPage step to the prev/next word from
  // wherever the DictionaryDock's own arrows are clicked, without re-deriving it from the raw
  // word text (which isn't unique within a segment).
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onTextUp: () => void;
  onSpanClick: (i: number, s: number, e: number, rect: DOMRect, color: string) => void;
  // Sujato's own translator notes (SegmentFile.note) — whether the asterisk markers show at all
  // ("c" in the reader, or the Theme tab's checkbox — see ReaderPage/ReaderMenuPanel), and which
  // ones are expanded inline (mirrors openSegs/onToggleSeg's per-segment-index shape).
  showNotes: boolean;
  openNotes: Record<number, boolean>;
  onToggleNote: (i: number) => void;
  // The word currently shown in the DictionaryDock, or null if none — ReaderPage memoizes this
  // on {segIndex, wordIndex} (not on the whole dict-state object) so it stays referentially
  // stable across renders where the active word hasn't actually changed; see the activeWordIndex
  // comment on SegmentRowProps for why that stability matters.
  activeWord: { segIndex: number; wordIndex: number } | null;
}

const EMPTY_HIGHLIGHTS: Highlight[] = [];

// The reader's paragraph renderer. Wrapped in `memo` (as is each `SegmentRow` below) so that
// state that's unrelated to the text itself — ReaderPage's word-lookup dock, side panel, mobile
// breakpoint, etc — doesn't force a full rebuild of a sutta's whole segment list (some suttas
// run 1000+ segments); a toggle scoped to one segment (Pali reveal, a note) only re-renders that
// row. Requires the callbacks ReaderPage passes in (onToggleSeg/onWordClick/onSpanClick/
// onToggleNote) to themselves be stable across unrelated renders (see ReaderPage's own
// useCallback wrapping) — an inline arrow function recreated every render would defeat this.
function SegmentedTextInner({
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
  activeWord,
}: SegmentedTextProps) {
  // Space between paragraphs — scales with both the Size and Line height reader controls (not a
  // fixed pixel value), so turning either up also opens up more room between paragraphs instead
  // of just within them. 0.6x a full computed line height reads as a clear paragraph break
  // without the gap dominating the page the way a full line height did.
  const paragraphGap = Math.round((fontSize * lineHeight * 0.6) / 100);
  // Grouped once per `highlights` change (O(segments + highlights)) rather than every segment
  // re-scanning the whole array (O(segments × highlights)).
  const highlightsBySeg = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const arr = map.get(h.i);
      if (arr) arr.push(h);
      else map.set(h.i, [h]);
    }
    return map;
  }, [highlights]);
  return (
    <div data-component="SegmentedText" data-segroot onMouseUp={onTextUp} onTouchEnd={onTextUp}>
      {segments.map((seg, i) => {
        // No gap at all between segments within the same paragraph (the English `<p>` has no
        // margin of its own either, so there's nothing left to collapse into a visible gap) —
        // only a real paragraph break (the next segment's paragraph number differs from this
        // one's) gets space, so same-paragraph segments read as one continuous block of text.
        const next = segments[i + 1];
        const lastInParagraph = !next || paragraphOf(next.key) !== paragraphOf(seg.key);
        return (
          <SegmentRow
            key={seg.key}
            seg={seg}
            i={i}
            hlForSeg={highlightsBySeg.get(i) ?? EMPTY_HIGHLIGHTS}
            open={allPali || !!openSegs[i]}
            lastInParagraph={lastInParagraph}
            theme={theme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            face={face}
            paragraphGap={paragraphGap}
            onToggleSeg={onToggleSeg}
            onWordClick={onWordClick}
            onSpanClick={onSpanClick}
            showNotes={showNotes}
            noteOpen={!!openNotes[i]}
            onToggleNote={onToggleNote}
            activeWordIndex={activeWord && activeWord.segIndex === i ? activeWord.wordIndex : null}
          />
        );
      })}
    </div>
  );
}

export const SegmentedText = memo(SegmentedTextInner);
