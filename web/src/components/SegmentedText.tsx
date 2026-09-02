import { memo, useMemo, type CSSProperties } from 'react';
import { isUntranslated, type SegmentFile, type SegmentRole } from '../lib/corpus';
import type { Highlight, ThemeColors } from '../lib/types';
import { highlightPaint } from '../lib/theme';
import { expandHighlights, paintSegmentRanges, type SegmentRange } from '../lib/highlights';
import { WORD_BOUNDARY, isWordBoundary } from '../lib/dictionary';

interface Part {
  text: string;
  c?: string;
  id?: string;
}

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
    // A verse line: no type change of its own; the indent and left rule live on the wrapper.
    case 'verse':
      return { fontStyle: 'normal' };
    // A sutta's internal sub-heading: bold, and a size up per level from <h5> to <h2>.
    case 'heading':
      return { fontWeight: 700, fontSize: fontSize + (5 - (headingLevel ?? 2)) };
    // A closing colophon ("The Tevijja Sutta is finished"): centred, muted, italic, a size down.
    case 'end':
      return { fontSize: Math.max(11, fontSize - 2), color: theme.dim, fontStyle: 'italic', textAlign: 'center' };
    // A dialogue attribution mid-verse ("said the Buddha,"): muted and a size down.
    case 'speaker':
      return { fontSize: Math.max(11, fontSize - 3), color: theme.dim };
    // Body prose, and a numbered list item — whose indent and "N." marker are set in the JSX.
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
    if (s > cur) parts.push({ text: text.slice(cur, s) });
    parts.push({ text: text.slice(s, e), c: src.c, id: src.id });
    cur = e;
  }
  if (cur < text.length) parts.push({ text: text.slice(cur) });
  return parts;
}

/** True for a closing line left untranslated, standing in the English column as its own Pali. */
function isUntranslatedColophon(seg: SegmentFile): boolean {
  return seg.role === 'end' && seg.pali.trim() === seg.en.trim();
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
  theme: ThemeColors,
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void
) {
  let wordIndex = -1;
  // Words and the whitespace or dashes between them; boundaries render as inert spans.
  return pali.split(WORD_BOUNDARY).map((t, j) => {
    if (isWordBoundary(t)) return <span key={j}>{t}</span>;
    const w = ++wordIndex;
    // True for the word the DictionaryDock is currently showing.
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
        {t}
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
  // Whether this segment belongs to the inner sutta a link pointed at within a batched document.
  focused: boolean;
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
  focused,
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
  const colophon = isUntranslatedColophon(seg);
  // A structural sub-heading (SuttaCentral's <h2>–<h5> nesting) renders as a real heading element
  // rather than a styled <p>, and takes the UI's sans font rather than the reading face, since it
  // is document structure rather than body prose.
  const HeadingTag: 'h2' | 'h3' | 'h4' | 'h5' | 'p' =
    seg.role === 'heading' ? (`h${seg.headingLevel ?? 2}` as 'h2' | 'h3' | 'h4' | 'h5') : 'p';
  // With the Pali leading, the English reads as the gloss under it and drops a step, which is what
  // puts the Pali at the top of the hierarchy. Size rather than colour: the accent brown the Pali
  // is set in can't out-weigh a near-black on a light ground however far the English is dimmed, and
  // dimming it far enough to try reads as broken rather than secondary. The reverse doesn't hold —
  // a Pali line under the English carries the accent colour and stays at the reading size, since it
  // is the line the reader taps words in.
  const glossFontSize = Math.round(fontSize * 0.9);
  // A list-item's "N.", pulled out of flow into the gutter its line's padding opens. It belongs to
  // the item as a whole, so it is rendered into whichever of the two lines comes first — the Pali
  // when that leads, the English otherwise — rather than stranded beside the item's second line.
  const listMarker = seg.role === 'list-item' && (
    // data-seg-ignore: rendered text that isn't part of `seg.en`, so the selection offsets
    // useHighlightPopup takes inside this paragraph discount it (see its IGNORED_TEXT).
    <span data-seg-ignore style={{ position: 'absolute', left: 0, width: 20, userSelect: 'none' }}>
      {listIndex}.
    </span>
  );
  const paliLine = open && !colophon && !isUntranslated(seg) && (
    <p
      className="animate-fadeUp"
      // The pair ReaderPage's revealIntoView scrolls to, named as the word spans above are.
      data-reveal="pali"
      data-reveal-seg={i}
      // --pw-hover backs .pw:hover (index.css). theme.tint rather than a fixed colour, so a
      // hovered Pali word stays a subtle wash against theme.pali in every theme.
      style={
        {
          // Leading, the Pali holds to the English under it at 2px and takes `pairGap` above to
          // separate the pair from the one before — segments within a paragraph sit flush, so
          // without it nothing says which English belongs to which Pali.
          margin: above ? `${pairGap}px 0 2px` : '6px 0 12px',
          fontSize,
          lineHeight: lineHeight / 100,
          fontFamily: face,
          color: theme.pali,
          '--pw-hover': theme.tint,
          ...UNSELECTABLE,
          // A closing line's English is centred (roleStyle), so the Pali beside it has to be
          // centred too — the two halves of one line, otherwise sitting on different axes.
          ...(seg.role === 'end' ? { textAlign: 'center' } : null),
          // Leading the segment, the Pali takes on what the English line carries when it leads: a
          // heading's top gap (which has to bind the pair to the section they open, not to the
          // paragraph above) and a list item's hanging indent and marker.
          ...(above && seg.role === 'heading' ? { marginTop: afterHeading ? 0 : headingGapTop } : null),
          ...(above && seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
        } as CSSProperties
      }
    >
      {above && listMarker}
      {paliWordSpans(seg.pali, i, activeWordIndex, theme, onWordClick)}
    </p>
  );
  // True when the Pali is actually rendered above — `above` alone isn't enough, since a segment
  // with no Pali of its own (an untranslated line, a colophon) renders none and leaves the English
  // to carry the segment's own spacing.
  const paliLeads = above && !!paliLine;
  const enFontSize = paliLeads ? glossFontSize : fontSize;
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
      {above && paliLine}
      <HeadingTag
        data-seg={i}
        className={seg.role === 'heading' ? 'font-sans' : undefined}
        onClick={() => {
          if (colophon || String(window.getSelection())) return;
          onToggleSeg(i);
        }}
        style={{
          margin: 0,
          cursor: colophon ? 'default' : 'pointer',
          fontSize: enFontSize,
          lineHeight: lineHeight / 100,
          color: theme.fg,
          ...(seg.role === 'heading' ? null : { fontFamily: face }),
          ...roleStyle(seg.role, enFontSize, theme, seg.headingLevel),
          ...(seg.role === 'heading'
            ? { marginTop: paliLeads || afterHeading ? 0 : headingGapTop, marginBottom: headingGapBottom }
            : null),
          // Indents the item's text so every wrapped line lines up under the first. The "N." marker
          // is pulled out of flow, absolutely positioned into the gutter this padding opens, rather
          // than set with a negative text-indent, which would put it left of every other
          // paragraph's edge instead of flush with it.
          ...(seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
          // --pw-hover backs .pw:hover (index.css), which the words of a colophon rendered in place
          // need just as much as those in a reveal below an English line. The line is unselectable
          // as a whole rather than only word by word: `.pw` covers the words, but the whitespace
          // between them is its own inert span, and a drag across an otherwise unselectable line
          // that picks up only the gaps is the same stray-selection nuisance `.pw` exists to avoid.
          ...(colophon ? { '--pw-hover': theme.tint, ...UNSELECTABLE } : null),
        } as CSSProperties}
      >
        {!paliLeads && listMarker}
        {colophon ? paliWordSpans(seg.pali, i, activeWordIndex, theme, onWordClick) : parts.map((p, j) =>
          p.c ? (
            <span
              key={j}
              // The id of the highlight this span was painted from, which a jump from the gutter or
              // the highlights panel matches (useSuttaReading's scrollToSegment) so it centres on
              // the highlighted text rather than on the whole, possibly much longer, segment. A
              // highlight spanning several segments renders the same id in each; the jump looks
              // only inside the segment it is scrolling to, which is the one it starts in.
              data-hl-id={p.id}
              // No user-select:none here, unlike `.pw` and the note asterisk below: this span sits
              // inside the same selectable English prose a highlight drag crosses, including a drag
              // through an existing highlight to extend it, so suppressing selection would break
              // that gesture. The text colour switches to theme.fg wherever the theme paints its
              // own fills — the near-black below assumes the light themes' pale pastel.
              style={{
                background: highlightPaint(p.c, theme),
                borderRadius: 2,
                boxShadow: `0 0 0 2px ${highlightPaint(p.c, theme)}`,
                color: theme.highlightPalette ? theme.fg : '#1B1917',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSpanClick(p.id!, (e.target as HTMLElement).getBoundingClientRect(), p.c!);
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
            // Padding rather than a bigger glyph is what grows the tap target, since a bare
            // `<sup>*</sup>` hit-tests to its own tiny painted glyph. Vertical padding on an inline,
            // non-replaced element doesn't affect line-height, so it is free; the horizontal
            // padding does add real space, which is fine at the end of a paragraph.
            // `verticalAlign`/`top` replace the browser's default `sup` raise, which sits the
            // asterisk near the line above, with a smaller fixed one just above the baseline.
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
          // Notes are static build-time data (build-corpus.mjs's cleanNote()) carrying inline
          // formatting, not user or runtime content, so rendering the markup is the same trust
          // level as rendering the sutta text itself.
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
  // Pali above the English rather than under it (ReaderPrefs' paliAbove) — ignored unless
  // `allPali` is on, since a tap reveal always belongs under the line it explains.
  paliAbove: boolean;
  onToggleSeg: (i: number) => void;
  // wordIndex is the tapped word's position among this segment's Pali tokens (lib/dictionary.ts's
  // splitPaliWords), so ReaderPage can step to the previous or next word from the DictionaryDock's
  // arrows without re-deriving it from the word text, which isn't unique within a segment.
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onSpanClick: (highlightId: string, rect: DOMRect, color: string) => void;
  // Bhikkhu Sujato's translator notes (SegmentFile.note): whether the asterisk markers show at all
  // ("c" in the reader, or the Display tab's checkbox), and which are expanded inline — the same
  // per-segment-index shape as openSegs/onToggleSeg.
  showNotes: boolean;
  openNotes: Record<number, boolean>;
  onToggleNote: (i: number) => void;
  // The word currently shown in the DictionaryDock, or null. ReaderPage memoizes it on
  // {segIndex, wordIndex} rather than the whole dict-state object, so it stays referentially stable
  // across renders where the active word hasn't changed — see SegmentRowProps' activeWordIndex.
  activeWord: { segIndex: number; wordIndex: number } | null;
  // The inner sutta a deep link/search hit pointed at within a batched document (e.g. "dhp321"
  // within the loaded "dhp320-333" document) — every segment whose key starts with `${focusUid}:`
  // gets a background wash (see SegmentRowProps.focused) so it's identifiable among the rest of
  // the batch. Undefined for a normal, non-batched sutta or a bare visit to the batch itself.
  focusUid?: string;
}

const EMPTY_RANGES: SegmentRange[] = [];

// The reader's paragraph renderer. Wrapped in `memo`, as is each `SegmentRow` below, so state
// unrelated to the text — the word-lookup dock, the side panel, the mobile breakpoint — doesn't
// rebuild a segment list that can run past 1000 rows, and a toggle scoped to one segment
// re-renders only that row. This requires the callbacks ReaderPage passes in to be stable across
// unrelated renders (see its useCallback wrapping).
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
  focusUid,
}: SegmentedTextProps) {
  // One line box at the current size and leading. Every vertical gap below is a fraction of it, so
  // the page's whole rhythm scales with both the Size and Line height reader controls rather than
  // being a fixed pixel value.
  const line = (fontSize * lineHeight) / 100;
  // Paragraph breaks sit a little under a full line: at a full line, baseline-to-baseline across a
  // break is exactly twice the leading, which at the airy end of the line-height scale reads as
  // disconnected blocks rather than one continuous text.
  const paragraphGap = Math.round(line * 0.8);
  // Above a leading Pali line: comfortably more than the 2px holding a pair together, comfortably
  // less than the paragraph break, so the pairs read as pairs without breaking the paragraph up.
  const pairGap = Math.round(line * 0.45);
  // A section heading has to bind downward, to the section it opens. Its top margin therefore has
  // to beat the preceding paragraph's own bottom margin outright rather than add to it — adjacent
  // margins collapse to the larger of the two, so a heading carrying the same value as a paragraph
  // break would get no extra room at all.
  const headingGapTop = Math.round(line * 1.8);
  const headingGapBottom = Math.round(line * 0.6);
  // Stored spans resolved into per-segment ranges once per change (O(segments + highlights)) rather
  // than every segment re-scanning the whole array (O(segments × highlights)). It depends on the
  // text as well as the highlights, since everything between a span's two endpoints is covered in
  // full — see lib/highlights.ts's highlightRanges.
  const rangesBySeg = useMemo(() => expandHighlights(highlights, segments), [highlights, segments]);
  // A list-item's ordinal within its run of consecutive list-item segments, reset to 0 whenever the
  // previous segment wasn't one, so a second list further down the sutta restarts at 1. Mutated in
  // iteration order inside the .map below rather than in a memoized pass of its own.
  let runningListIndex = 0;
  return (
    <div data-component="SegmentedText" data-segroot>
      {segments.map((seg, i) => {
        // No gap between segments within the same paragraph — the English `<p>` carries no margin
        // either, so nothing is left to collapse into a visible one. Only a real paragraph break,
        // where the next segment's paragraph number differs, gets space.
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
            focused={!!focusUid && seg.key.startsWith(`${focusUid}:`)}
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
      })}
    </div>
  );
}

export const SegmentedText = memo(SegmentedTextInner);
