import { Fragment, memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { SegmentFile, SegmentRole } from '../lib/corpus/corpus';
import type { Highlight, ThemeColors } from '../lib/types';
import { highlightPaint } from '../lib/theme';
import { expandHighlights, paintSegmentRanges, type SegmentRange } from '../lib/highlights';
import { WORD_BOUNDARY, isWordBoundary } from '../lib/corpus/dictionary';
import { runsOf, type Mark } from '../lib/search/match';

interface Part {
  text: string;
  // Where the part begins in the segment's English.
  start: number;
  c?: string;
  id?: string;
}

// The stretches of a segment's lines an arriving search hit marks, as offsets into its English and
// its Pali.
export interface SegmentMarks {
  en: Mark[];
  pa: Mark[];
}

const NO_MARKS: Mark[] = [];

/** Returns the paragraph a segment key belongs to — its uid plus the digits before the first dot. */
function paragraphOf(key: string): string {
  const colon = key.indexOf(':');
  const uid = key.slice(0, colon);
  const segId = key.slice(colon + 1);
  const dot = segId.indexOf('.');
  return dot === -1 ? uid : `${uid}:${segId.slice(0, dot)}`;
}

/** Returns the type treatment for a segment's structural role, over the base English style. */
function roleStyle(
  role: SegmentRole | undefined,
  fontSize: number,
  theme: ThemeColors,
  headingLevel?: 2 | 3 | 4 | 5
): CSSProperties {
  switch (role) {
    // A verse line: no type change; the indent and left rule live on the wrapper.
    case 'verse':
      return { fontStyle: 'normal' };
    // A sub-heading: bold, and a size up per level from <h5> to <h2>.
    case 'heading':
      return { fontWeight: 700, fontSize: fontSize + (5 - (headingLevel ?? 2)) };
    // A closing colophon: centred, muted, italic, a size down.
    case 'end':
      return { fontSize: Math.max(11, fontSize - 2), color: theme.dim, fontStyle: 'italic', textAlign: 'center' };
    // A dialogue attribution: muted, a size down.
    case 'speaker':
      return { fontSize: Math.max(11, fontSize - 3), color: theme.dim };
    // Body prose and list items: no type change; a list item's indent and marker are set in the JSX.
    default:
      return {};
  }
}

/** Returns a note's text with its inline HTML removed, for a `title` attribute. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/** Slices a segment's text into alternating plain and highlighted runs, each naming its highlight. */
function buildParts(text: string, rangesForSeg: SegmentRange[]): Part[] {
  const parts: Part[] = [];
  let cur = 0;
  for (const { s, e, src } of paintSegmentRanges(rangesForSeg)) {
    if (s > cur) parts.push({ text: text.slice(cur, s), start: cur });
    parts.push({ text: text.slice(s, e), start: s, c: src.c, id: src.id });
    cur = e;
  }
  if (cur < text.length) parts.push({ text: text.slice(cur), start: cur });
  return parts;
}

/** Returns `marks` merged as a search result row merges them (runsOf), as offsets into `line`. */
function mergedMarks(line: string, marks: Mark[]): Mark[] {
  if (!marks.length) return NO_MARKS;
  const merged: Mark[] = [];
  let at = 0;
  for (const run of runsOf(line, marks)) {
    if (run.hit) merged.push([at, at + run.text.length]);
    at += run.text.length;
  }
  return merged;
}

/**
 * Returns `text`, the slice of a line from offset `from`, with the stretches of `marks` inside it
 * filled with `fill`, as search results mark the words they were found by.
 */
function marked(text: string, from: number, marks: Mark[], fill: string): ReactNode {
  const inside = marks
    .map(([start, end]): Mark => [Math.max(start, from) - from, Math.min(end, from + text.length) - from])
    .filter(([start, end]) => start < end);
  if (!inside.length) return text;
  return runsOf(text, inside).map((run, k) =>
    run.hit ? (
      <mark key={k} style={{ color: 'inherit', background: fill }}>
        {run.text}
      </mark>
    ) : (
      <Fragment key={k}>{run.text}</Fragment>
    )
  );
}

// Black mixed into a stored pastel highlight under a search mark, in percent.
const MARK_SHADE_PASTEL = 15;
// Black mixed into a theme's own highlight fill under a search mark, in percent.
const MARK_SHADE_FILL = 30;

/** Returns the fill of a search mark inside a highlight painted `paint`: that paint a shade darker. */
function markOnHighlight(paint: string, theme: ThemeColors): string {
  const shade = theme.highlightPalette ? MARK_SHADE_FILL : MARK_SHADE_PASTEL;
  return `color-mix(in srgb, ${paint}, black ${shade}%)`;
}

// Makes a whole Pali line unselectable, as `.pw` (index.css) does for its words.
const UNSELECTABLE: CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

/** Renders a Pali line as per-word spans, each opening the DictionaryDock when tapped. */
function paliWordSpans(
  pali: string,
  segIndex: number,
  activeWordIndex: number | null,
  // What an arriving search hit marks in the line, as offsets into `pali`.
  marks: Mark[],
  theme: ThemeColors,
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void
) {
  let wordIndex = -1;
  // Where the next token starts in `pali`.
  let at = 0;
  // Words and the whitespace or dashes between them; boundaries render as inert spans.
  return pali.split(WORD_BOUNDARY).map((t, j) => {
    const from = at;
    at += t.length;
    if (isWordBoundary(t)) return <span key={j}>{marked(t, from, marks, theme.selection)}</span>;
    const w = ++wordIndex;
    const isActive = w === activeWordIndex;
    return (
      <span
        key={j}
        className="pw"
        // The word's address, which scrollToWordIfCovered looks it up by.
        data-word-seg={segIndex}
        data-word={w}
        style={isActive ? { background: theme.tint } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onWordClick(t, segIndex, w);
        }}
      >
        {marked(t, from, marks, theme.selection)}
      </span>
    );
  });
}

interface SegmentRowProps {
  seg: SegmentFile;
  i: number;
  // The parts of every highlight that fall inside this segment.
  rangesForSeg: SegmentRange[];
  // Whether this segment's Pali is showing.
  open: boolean;
  lastInParagraph: boolean;
  // A list item's 1-based ordinal within its run of consecutive list items.
  listIndex?: number;
  afterVerse: boolean;
  // Whether the Pali line leads the segment rather than following the English.
  above: boolean;
  afterHeading: boolean;
  // What an arriving search hit marks in this segment's lines.
  marks?: SegmentMarks;
  theme: ThemeColors;
  fontSize: number;
  lineHeight: number;
  face: string;
  // Space below the segment when it ends a paragraph.
  paragraphGap: number;
  // Space above the Pali line when it leads.
  pairGap: number;
  // Space above and below a heading.
  headingGapTop: number;
  headingGapBottom: number;
  onToggleSeg: (i: number) => void;
  // Called with the tapped word and its position among this segment's Pali words.
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onSpanClick: (highlightId: string, rect: DOMRect, color: string) => void;
  showNotes: boolean;
  noteOpen: boolean;
  onToggleNote: (i: number) => void;
  // The word the DictionaryDock is showing, when it is in this segment.
  activeWordIndex: number | null;
}

/** One sutta segment — a paragraph, verse line, heading — as its English and Pali lines. */
const SegmentRow = memo(function SegmentRow({
  seg,
  i,
  rangesForSeg,
  open,
  lastInParagraph,
  afterVerse,
  afterHeading,
  above,
  listIndex,
  marks,
  theme,
  fontSize,
  lineHeight,
  face,
  paragraphGap,
  pairGap,
  headingGapTop,
  headingGapBottom,
  onToggleSeg,
  onWordClick,
  onSpanClick,
  showNotes,
  noteOpen,
  onToggleNote,
  activeWordIndex,
}: SegmentRowProps) {
  const parts = buildParts(seg.en, rangesForSeg);
  const enMarks = marks ? mergedMarks(seg.en, marks.en) : NO_MARKS;
  const paMarks = marks ? mergedMarks(seg.pali, marks.pa) : NO_MARKS;
  // The element a segment renders as: <h2>–<h5> for a sub-heading, <p> for everything else.
  const HeadingTag: 'h2' | 'h3' | 'h4' | 'h5' | 'p' =
    seg.role === 'heading' ? (`h${seg.headingLevel ?? 2}` as 'h2' | 'h3' | 'h4' | 'h5') : 'p';
  // English size when the Pali leads, a step under the reading size.
  const glossFontSize = Math.round(fontSize * 0.9);
  // A list item's "N.", absolutely positioned into the gutter its line's padding opens, and
  // rendered into whichever of the two lines comes first — the Pali when that leads, else the
  // English.
  const listMarker = seg.role === 'list-item' && (
    // data-seg-ignore: rendered text that isn't part of `seg.en`, so the selection offsets
    // useHighlightPopup takes inside this paragraph discount it (see its IGNORED_TEXT).
    <span data-seg-ignore style={{ position: 'absolute', left: 0, width: 20, userSelect: 'none' }}>
      {listIndex}.
    </span>
  );
  const paliLine = open && (
    <p
      className="animate-fadeUp"
      // The pair ReaderPage's revealIntoView scrolls to, named as the word spans above are.
      data-reveal="pali"
      data-reveal-seg={i}
      // --pw-hover backs .pw:hover (index.css).
      style={
        {
          // Margins: `pairGap` above and 2px below when the Pali leads, 6px/12px when it follows.
          margin: above ? `${pairGap}px 0 2px` : '6px 0 12px',
          fontSize,
          lineHeight: lineHeight / 100,
          fontFamily: face,
          color: theme.pali,
          '--pw-hover': theme.tint,
          ...UNSELECTABLE,
          // A closing colophon is centred, matching its English line (roleStyle).
          ...(seg.role === 'end' ? { textAlign: 'center' } : null),
          // Leading the segment, the Pali carries what the English line otherwise would:
          //   heading   – the section's top gap
          //   list-item – the hanging indent the marker sits in
          ...(above && seg.role === 'heading' ? { marginTop: afterHeading ? 0 : headingGapTop } : null),
          ...(above && seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
        } as CSSProperties
      }
    >
      {above && listMarker}
      {paliWordSpans(seg.pali, i, activeWordIndex, paMarks, theme, onWordClick)}
    </p>
  );
  // True when a Pali line is actually rendered above the English, not merely requested.
  const paliLeads = above && !!paliLine;
  const enFontSize = paliLeads ? glossFontSize : fontSize;
  return (
    <div
      id={seg.key}
      style={{
        marginBottom: lastInParagraph ? paragraphGap : 0,
        ...(seg.role === 'verse' ? { paddingLeft: 14, borderLeft: `2px solid ${theme.rule}` } : null),
        // A speaker attribution following a verse keeps the verse's indent and rule.
        ...(seg.role === 'speaker' && afterVerse ? { paddingLeft: 28, borderLeft: `2px solid ${theme.rule}` } : null),
      }}
    >
      {above && paliLine}
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
          fontSize: enFontSize,
          lineHeight: lineHeight / 100,
          color: theme.fg,
          ...(seg.role === 'heading' ? null : { fontFamily: face }),
          ...roleStyle(seg.role, enFontSize, theme, seg.headingLevel),
          ...(seg.role === 'heading'
            ? { marginTop: paliLeads || afterHeading ? 0 : headingGapTop, marginBottom: headingGapBottom }
            : null),
          // A list item's hanging indent: wrapped lines align under the first, and the "N." marker
          // sits in the gutter this padding opens.
          ...(seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
        } as CSSProperties}
      >
        {!paliLeads && listMarker}
        {parts.map((p, j) =>
          p.c ? (
            <span
              key={j}
              // The id of the highlight this span was painted from, which useSuttaReading's
              // scrollToSegment jumps to. A highlight spanning several segments repeats it in each.
              data-hl-id={p.id}
              // The span stays selectable, unlike `.pw` and the note asterisk, so a drag can cross
              // or extend an existing highlight. The text colour is theme.fg wherever the theme
              // paints its own fills, and a near-black otherwise.
              style={{
                background: highlightPaint(p.c, theme),
                borderRadius: 2,
                boxShadow: `0 0 0 2px ${highlightPaint(p.c, theme)}`,
                color: theme.highlightPalette ? theme.fg : '#1B1917',
              }}
              onClick={(e) => {
                e.stopPropagation();
                // The span's own box, not that of a search mark inside it that took the click.
                onSpanClick(p.id!, e.currentTarget.getBoundingClientRect(), p.c!);
              }}
            >
              {marked(p.text, p.start, enMarks, markOnHighlight(highlightPaint(p.c, theme), theme))}
            </span>
          ) : (
            <span key={j}>{marked(p.text, p.start, enMarks, theme.selection)}</span>
          )
        )}
        {seg.note && showNotes && (
          <sup
            // As the list-item marker above: rendered text that isn't part of `seg.en`, so
            // useHighlightPopup's offsets discount it.
            data-seg-ignore
            // Padding grows the asterisk's tap target beyond its painted glyph; `verticalAlign`
            // and `top` replace the browser's default `sup` raise with a smaller one.
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
      {!above && paliLine}
      {showNotes && seg.note && noteOpen && (
        <p
          className="animate-fadeUp"
          data-reveal="note"
          data-reveal-seg={i}
          style={{ margin: '0 0 6px', fontSize: Math.max(11, fontSize - 3), lineHeight: 1.5, fontFamily: face, color: theme.dim }}
          // A note's inline formatting is static build-time data (build-corpus.mjs's cleanNote()),
          // never user or runtime content.
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
  // Pali above the English rather than under it; applies only while `allPali` is on.
  paliAbove: boolean;
  onToggleSeg: (i: number) => void;
  // Called with the tapped word and its position among this segment's Pali tokens
  // (lib/corpus/dictionary.ts's splitPaliWords).
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onSpanClick: (highlightId: string, rect: DOMRect, color: string) => void;
  // Whether the translator-note asterisks show at all.
  showNotes: boolean;
  // Which notes are expanded inline, by segment index.
  openNotes: Record<number, boolean>;
  onToggleNote: (i: number) => void;
  // The word currently shown in the DictionaryDock, or null.
  activeWord: { segIndex: number; wordIndex: number } | null;
  // The first and last segment of the passage the reader arrived at, washed and then faded out.
  washRange?: [number, number];
  // The arrival the wash belongs to, so arriving again at the same passage washes it again.
  washId?: string;
  // What an arriving search hit marks, by segment index.
  marks?: Map<number, SegmentMarks>;
}

const EMPTY_RANGES: SegmentRange[] = [];

// Renders a sutta's segments. Memoized, as is each SegmentRow, which requires every callback
// ReaderPage passes in to be stable across unrelated renders.
function SegmentedTextInner({
  segments,
  highlights,
  theme,
  fontSize,
  lineHeight,
  face,
  openSegs,
  allPali,
  paliAbove,
  onToggleSeg,
  onWordClick,
  onSpanClick,
  showNotes,
  openNotes,
  onToggleNote,
  activeWord,
  washRange,
  washId,
  marks,
}: SegmentedTextProps) {
  // One line box at the current size and leading; every gap below is a fraction of it.
  const line = (fontSize * lineHeight) / 100;
  // Space below a segment that ends a paragraph.
  const paragraphGap = Math.round(line * 0.8);
  // Space above a leading Pali line.
  const pairGap = Math.round(line * 0.45);
  // Space above a heading, which must exceed paragraphGap to survive margin collapsing.
  const headingGapTop = Math.round(line * 1.8);
  // Space below a heading.
  const headingGapBottom = Math.round(line * 0.6);
  // Every highlight's stored span resolved into the ranges falling in each segment, by segment
  // index — see lib/highlights.ts's highlightRanges.
  const rangesBySeg = useMemo(() => expandHighlights(highlights, segments), [highlights, segments]);
  // A list item's ordinal within its run of consecutive list-item segments, reset to 0 by any
  // other segment so a later list restarts at 1.
  let runningListIndex = 0;
  const rows = segments.map((seg, i) => {
    // A paragraph break: the next segment's paragraph number differs, or there is none.
    const next = segments[i + 1];
    const lastInParagraph = !next || paragraphOf(next.key) !== paragraphOf(seg.key);
    runningListIndex = seg.role === 'list-item' ? runningListIndex + 1 : 0;
    return (
      <SegmentRow
        key={seg.key}
        seg={seg}
        i={i}
        rangesForSeg={rangesBySeg.get(i) ?? EMPTY_RANGES}
        open={allPali || !!openSegs[i]}
        lastInParagraph={lastInParagraph}
        afterVerse={segments[i - 1]?.role === 'verse'}
        afterHeading={segments[i - 1]?.role === 'heading'}
        above={allPali && paliAbove}
        listIndex={seg.role === 'list-item' ? runningListIndex : undefined}
        marks={marks?.get(i)}
        theme={theme}
        fontSize={fontSize}
        lineHeight={lineHeight}
        face={face}
        paragraphGap={paragraphGap}
        pairGap={pairGap}
        headingGapTop={headingGapTop}
        headingGapBottom={headingGapBottom}
        onToggleSeg={onToggleSeg}
        onWordClick={onWordClick}
        onSpanClick={onSpanClick}
        showNotes={showNotes}
        noteOpen={!!openNotes[i]}
        onToggleNote={onToggleNote}
        activeWordIndex={activeWord && activeWord.segIndex === i ? activeWord.wordIndex : null}
      />
    );
  });
  return (
    <div data-component="SegmentedText" data-segroot>
      {washRange ? (
        <>
          {rows.slice(0, washRange[0])}
          {/* The arrival wash, tinted out to the reading pane's edges, which clip the shadow; keyed
              by its arrival and range, so each new arrival starts its fade over. */}
          <div
            key={`${washId}:${washRange.join('-')}`}
            className="arrival-wash"
            data-wash-block
            style={{
              background: theme.focusTint,
              boxShadow: `0 0 0 100vmax ${theme.focusTint}`,
              clipPath: 'inset(0 -100vmax)',
            }}
          >
            {rows.slice(washRange[0], washRange[1] + 1)}
          </div>
          {rows.slice(washRange[1] + 1)}
        </>
      ) : (
        rows
      )}
    </div>
  );
}

export const SegmentedText = memo(SegmentedTextInner);
