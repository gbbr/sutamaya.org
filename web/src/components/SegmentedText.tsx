import { memo, useMemo, type CSSProperties } from 'react';
import type { SegmentFile, SegmentRole } from '../lib/corpus';
import type { Highlight, ThemeColors } from '../lib/types';
import { highlightPaint } from '../lib/theme';
import { paintSegmentHighlights } from '../lib/highlights';
import { WORD_BOUNDARY, isWordBoundary } from '../lib/dictionary';

interface Part {
  text: string;
  c?: string;
  s?: number;
  e?: number;
  id?: string;
}

// A segment key is "{uid}:{paragraph}.{sub...}" (e.g. "an8.70:3.7.0" is paragraph 3) — the digit
// group right after the colon and before the first '.' is the paragraph number shared by every
// segment within it, regardless of how deep the rest of the key nests. Grouping includes the uid
// itself (not just that digit) because a *batched* leaf document (several inner suttas in one
// file, e.g. "dhp320-333") numbers each inner sutta's lines flatly with no dot at all — "dhp320:1"
// … "dhp320:4", then resetting to "dhp321:1" — so the uid boundary, not a digit, is what actually
// marks a new paragraph there; a real single-sutta document never has an undotted body key (only
// its "0"/"0.*" title lines do, already stripped before this ever runs), so falling back to the
// bare uid when there's no dot only ever fires for that batched case.
function paragraphOf(key: string): string {
  const colon = key.indexOf(':');
  const uid = key.slice(0, colon);
  const segId = key.slice(colon + 1);
  const dot = segId.indexOf('.');
  return dot === -1 ? uid : `${uid}:${segId.slice(0, dot)}`;
}

// Per-role style on top of the base English `<p>` style (see SegmentFile.role) — a light,
// legible-but-distinct treatment for each of SuttaCentral's own structural roles, rather than
// every segment reading as identical body prose:
//   - verse: no type change of its own — it reads as verse from the quoted-block left rule and
//     indent, which live on the wrapping div rather than here (see the JSX below) so one rule
//     spans a whole stanza in a single line.
//   - heading: bold and a size up, for a sutta's own internal sub-headings (e.g. DN9's numbered
//     sections, or DN2's <h5>-deep "4.3.3.2. Mind-Made Body" sub-sections). A heading's key shares
//     its paragraph number with the body text right after it (e.g. "6.0" the heading, "6.1"/"6.2"/…
//     its paragraph), so the wrapping div's own "no gap within a paragraph" margin never fires for
//     it — the heading element gets its own top/bottom margin instead (below, in the JSX), more
//     above than below like a normal heading.
//     <h3>/<h4>/<h5> (nested under an <h2> — see SegmentFile.headingLevel) step down from the
//     <h2> size one notch at a time, so all four actually read as one hierarchy rather than
//     matching it or each other.
//   - end: a closing colophon note ("The Tevijja Sutta is finished") — centered, muted, and a
//     size down, read as a trailing note rather than more body text.
//   - speaker: an inline dialogue attribution embedded mid-verse ("said the Buddha,") — muted,
//     a size down, and deliberately *not* italic, so it stands apart from the verse around it.
//   - list-item: a genuine `<ol>`/`<li>` numbered list embedded in body prose (e.g. DN28 §10's
//     four types of practice — see build-corpus.mjs's roleFor()/buildBodySegments). Segments
//     render as plain text, not real DOM `<li>`s, so there's no browser-generated marker — a
//     hanging indent (`paddingLeft`, set in the JSX below since it isn't part of the base
//     font/color styling this function returns) plus a literal "N." prefix positioned into the
//     gutter it opens (SegmentRow's own JSX, from the running listIndex prop) stand in for one.
function roleStyle(
  role: SegmentRole | undefined,
  fontSize: number,
  theme: ThemeColors,
  headingLevel?: 2 | 3 | 4 | 5
): CSSProperties {
  switch (role) {
    case 'verse':
      return { fontStyle: 'normal' };
    case 'heading':
      return { fontWeight: 700, fontSize: fontSize + (5 - (headingLevel ?? 2)) };
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

// Slices a segment's text into rendered runs, highlighted and plain alternating. Overlaps between
// two groups are resolved by paintSegmentHighlights (lib/highlights.ts) rather than here, since
// which one wins the contested characters is a rule shared with the rest of the app, not a
// rendering detail.
//
// A part's `s`/`e` are the winning highlight's own *stored* range, not the piece being drawn —
// they're what a click hands back to openPop, which locates the group by exact stored offsets, so
// clicking the visible half of a partly-covered highlight still acts on the whole thing.
function buildParts(text: string, hlForSeg: Highlight[]): Part[] {
  const parts: Part[] = [];
  let cur = 0;
  for (const { s, e, src } of paintSegmentHighlights(hlForSeg)) {
    if (s > cur) parts.push({ text: text.slice(cur, s) });
    parts.push({ text: text.slice(s, e), c: src.c, s: src.s, e: src.e, id: src.id });
    cur = e;
  }
  if (cur < text.length) parts.push({ text: text.slice(cur) });
  return parts;
}

interface SegmentRowProps {
  seg: SegmentFile;
  i: number;
  hlForSeg: Highlight[];
  open: boolean;
  lastInParagraph: boolean;
  // Only meaningful when seg.role === 'list-item' — this item's 1-based ordinal within its own
  // run of consecutive list-item segments (reset at the first non-list-item segment above it), so
  // it can render a real "1."/"2."/… marker despite segments having no actual DOM <li> of their
  // own to get one from the browser (see SegmentedTextInner's own running counter).
  listIndex?: number;
  afterVerse: boolean;
  // True when this segment belongs to the specific inner sutta a deep link/search hit pointed at
  // within a batched document (see SegmentedTextProps.focusUid) — gets a soft background wash so
  // it's identifiable among the rest of the (otherwise identical-looking) batch.
  focused: boolean;
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
  afterVerse,
  listIndex,
  focused,
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
  // A structural sub-heading (SuttaCentral's own <h2>–<h5> nesting — see build-corpus.mjs's
  // roleFor()) renders as a real heading element, not a styled <p>, and picks up the UI's sans
  // font (like the reader's chrome) rather than the reading face — it's document structure, not
  // body prose.
  const HeadingTag: 'h2' | 'h3' | 'h4' | 'h5' | 'p' =
    seg.role === 'heading' ? (`h${seg.headingLevel ?? 2}` as 'h2' | 'h3' | 'h4' | 'h5') : 'p';
  return (
    <div
      id={seg.key}
      style={{
        marginBottom: lastInParagraph ? paragraphGap : 0,
        ...(focused ? { background: theme.focusTint } : null),
        ...(seg.role === 'verse' ? { paddingLeft: 14, borderLeft: `2px solid ${theme.rule}` } : null),
        // A speaker attribution ("said the Buddha,") immediately after a verse line reads as
        // part of that verse, so it should sit at the verse's own indentation and quote rule
        // rather than snapping back to the margin.
        ...(seg.role === 'speaker' && afterVerse ? { paddingLeft: 28, borderLeft: `2px solid ${theme.rule}` } : null),
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
          // Indents the item's own text so it lines up under itself on every wrapped line, not
          // just the first — the "N." marker below is pulled out of flow entirely (absolutely
          // positioned into the gutter this padding opens up) rather than using a negative
          // text-indent, which pushed the marker to the left of every other paragraph's own edge
          // instead of flush with it.
          ...(seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
        }}
      >
        {seg.role === 'list-item' && (
          // data-seg-ignore: rendered text that isn't part of `seg.en`, so the selection offsets
          // useHighlightPopup takes inside this paragraph discount it (see its IGNORED_TEXT).
          <span data-seg-ignore style={{ position: 'absolute', left: 0, width: 20, userSelect: 'none' }}>{listIndex}.</span>
        )}
        {parts.map((p, j) =>
          p.c ? (
            <span
              key={j}
              // Identifies which highlight (its first segment's own doc id — see HighlightGroup's
              // `key` in lib/highlights.ts, which is the same id) this span belongs to, so a jump
              // triggered from the gutter/highlights panel (useSuttaReading's scrollToSegment) can
              // center on the actually-highlighted text rather than this whole (possibly much
              // longer) segment — see that function's own comment.
              data-hl-id={p.id}
              // Deliberately no user-select:none here, unlike `.pw`/the note asterisk below —
              // this span sits inside the same selectable English prose the highlight-selection
              // feature drags across (including dragging *through* an existing highlight to
              // extend/merge it), so suppressing selection on it would break that drag mid-gesture.
              // Text color switches to theme.fg once the paint itself dims below opaque (dark
              // theme): the near-black below assumes an opaque pastel background, which doesn't
              // hold once that background is alpha-composited over a dark page.
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
            // As the list-item marker above: rendered text that isn't part of `seg.en`, so
            // useHighlightPopup's offsets discount it.
            data-seg-ignore
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
              // Driven by real state (the word currently shown in the DictionaryDock), not CSS
              // :hover — needs to stay active once the dock's own prev/next arrows move the
              // lookup to a word the pointer was never actually over, which :hover can't express.
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
  // Bhikkhu Sujato's own translator notes (SegmentFile.note) — whether the asterisk markers show at all
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
  // The inner sutta a deep link/search hit pointed at within a batched document (e.g. "dhp321"
  // within the loaded "dhp320-333" document) — every segment whose key starts with `${focusUid}:`
  // gets a background wash (see SegmentRowProps.focused) so it's identifiable among the rest of
  // the batch. Undefined for a normal, non-batched sutta or a bare visit to the batch itself.
  focusUid?: string;
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
  focusUid,
}: SegmentedTextProps) {
  // Space between paragraphs — one full computed line height, so it scales with both the Size and
  // Line height reader controls rather than being a fixed pixel value: turning either up opens up
  // more room between paragraphs as well as within them.
  const paragraphGap = Math.round((fontSize * lineHeight) / 100);
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
  // A list-item's ordinal within its own run of consecutive list-item segments — reset to 0
  // whenever the previous segment wasn't also one, so a second, unrelated <ol> further down the
  // same sutta restarts its own numbering at 1 rather than continuing the first list's count.
  // Mutated in iteration order inside the .map below (arrays iterate in order, so this is safe),
  // not a separate memoized pass — cheap enough not to need one (see highlightsBySeg above, which
  // *does* justify memoizing since it's an O(segments × highlights) scan otherwise).
  let runningListIndex = 0;
  return (
    <div data-component="SegmentedText" data-segroot onMouseUp={onTextUp} onTouchEnd={onTextUp}>
      {segments.map((seg, i) => {
        // No gap at all between segments within the same paragraph (the English `<p>` has no
        // margin of its own either, so there's nothing left to collapse into a visible gap) —
        // only a real paragraph break (the next segment's paragraph number differs from this
        // one's) gets space, so same-paragraph segments read as one continuous block of text.
        const next = segments[i + 1];
        const lastInParagraph = !next || paragraphOf(next.key) !== paragraphOf(seg.key);
        runningListIndex = seg.role === 'list-item' ? runningListIndex + 1 : 0;
        return (
          <SegmentRow
            key={seg.key}
            seg={seg}
            i={i}
            hlForSeg={highlightsBySeg.get(i) ?? EMPTY_HIGHLIGHTS}
            open={allPali || !!openSegs[i]}
            lastInParagraph={lastInParagraph}
            afterVerse={segments[i - 1]?.role === 'verse'}
            listIndex={seg.role === 'list-item' ? runningListIndex : undefined}
            focused={!!focusUid && seg.key.startsWith(`${focusUid}:`)}
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
