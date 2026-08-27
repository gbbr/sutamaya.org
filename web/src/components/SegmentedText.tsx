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

// A segment key is "{uid}:{paragraph}.{sub...}" — "an8.70:3.7.0" is paragraph 3. The digit group
// after the colon and before the first '.' is the paragraph number every segment in that paragraph
// shares, however deep the rest of the key nests.
//
// Grouping includes the uid, not just that digit, because a batched leaf document — several inner
// suttas in one file, "dhp320-333" — numbers each inner sutta's lines flatly with no dot at all
// ("dhp320:1" … "dhp320:4", then "dhp321:1"), so there the uid boundary marks a new paragraph. A
// single-sutta document never has an undotted body key, its "0"/"0.*" title lines having already
// been stripped, so the bare-uid fallback only ever fires for the batched case.
function paragraphOf(key: string): string {
  const colon = key.indexOf(':');
  const uid = key.slice(0, colon);
  const segId = key.slice(colon + 1);
  const dot = segId.indexOf('.');
  return dot === -1 ? uid : `${uid}:${segId.slice(0, dot)}`;
}

// Per-role style on top of the base English `<p>` style, one treatment per structural role
// SuttaCentral marks up (see SegmentFile.role):
//   - verse: no type change of its own. It reads as verse from the quoted-block left rule and
//     indent, which live on the wrapping div so one rule spans a whole stanza.
//   - heading: bold and a size up, for a sutta's internal sub-headings. A heading's key shares its
//     paragraph number with the body text after it ("6.0" the heading, "6.1"/"6.2" its paragraph),
//     so the wrapping div's "no gap within a paragraph" margin never fires for it — the heading
//     element carries its own top and bottom margin instead, more above than below.
//     <h3>/<h4>/<h5> (see SegmentFile.headingLevel) step down from the <h2> one notch at a time, so
//     all four read as one hierarchy.
//   - end: a closing colophon ("The Tevijja Sutta is finished") — centered, muted and a size down.
//   - speaker: an inline dialogue attribution mid-verse ("said the Buddha,") — muted, a size down
//     and not italic, so it stands apart from the verse around it.
//   - list-item: a numbered list embedded in body prose (build-corpus.mjs's roleFor()). Segments
//     render as plain text rather than real `<li>`s, so there is no browser-generated marker: a
//     hanging indent (`paddingLeft`, set in the JSX) plus a literal "N." positioned into the gutter
//     it opens (from the running listIndex prop) stand in for one.
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

// Plain-text version of a note for the native `title` attribute: a title can't render the inline
// HTML a note may contain, which the click-to-expand view below does render.
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

// Slices a segment's text into rendered runs, highlighted and plain alternating. Overlaps between
// two groups are resolved by paintSegmentHighlights (lib/highlights.ts) rather than here, since
// which one wins the contested characters is a rule shared with the rest of the app, not a
// rendering detail.
//
// A part's `s`/`e` are the winning highlight's stored range, not the piece being drawn — they are
// what a click hands back to openPop, which locates the group by exact stored offsets, so clicking
// the visible half of a partly-covered highlight acts on the whole of it.
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
  // Only meaningful when seg.role === 'list-item': this item's 1-based ordinal within its run of
  // consecutive list-item segments, reset at the first non-list-item segment above it, so it can
  // render a "1."/"2." marker that no DOM <li> exists to produce.
  listIndex?: number;
  afterVerse: boolean;
  // True when the segment immediately above is itself a heading — a subheading stacked under its
  // parent is one unit with it, so it drops its own top margin and lets the parent's bottom margin
  // set the (much smaller) gap.
  afterHeading: boolean;
  // True when this segment belongs to the specific inner sutta a deep link/search hit pointed at
  // within a batched document (see SegmentedTextProps.focusUid) — gets a soft background wash so
  // it's identifiable among the rest of the (otherwise identical-looking) batch.
  focused: boolean;
  theme: ThemeColors;
  fontSize: number;
  lineHeight: number;
  face: string;
  paragraphGap: number;
  // Kept as two scalars rather than one `{top, bottom}` object: SegmentRow is memoized, and a
  // fresh object per parent render would miss on every row.
  headingGapTop: number;
  headingGapBottom: number;
  onToggleSeg: (i: number) => void;
  // wordIndex is the tapped word's position among this segment's Pali tokens (lib/dictionary.ts's
  // splitPaliWords), so ReaderPage can step to the previous or next word from the DictionaryDock's
  // arrows without re-deriving it from the word text, which isn't unique within a segment.
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onSpanClick: (i: number, s: number, e: number, rect: DOMRect, color: string) => void;
  showNotes: boolean;
  noteOpen: boolean;
  onToggleNote: (i: number) => void;
  // The word index within this segment currently shown in the DictionaryDock, or null when this
  // segment isn't the active one. A plain nullable number rather than the {segIndex, wordIndex}
  // pair, so an unrelated row keeps seeing `null` across a click elsewhere and its `memo` bails.
  activeWordIndex: number | null;
}

// One sutta segment — a paragraph, verse line, heading and so on (see SegmentFile). Memoized, so
// toggling one segment's Pali reveal or note, or changing highlights elsewhere in the sutta, only
// re-renders the rows whose props changed rather than a list that can run past 1000 segments.
const SegmentRow = memo(function SegmentRow({
  seg,
  i,
  hlForSeg,
  open,
  lastInParagraph,
  afterVerse,
  afterHeading,
  listIndex,
  focused,
  theme,
  fontSize,
  lineHeight,
  face,
  paragraphGap,
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
  const parts = buildParts(seg.en, hlForSeg);
  // A structural sub-heading (SuttaCentral's <h2>–<h5> nesting) renders as a real heading element
  // rather than a styled <p>, and takes the UI's sans font rather than the reading face, since it
  // is document structure rather than body prose.
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
          ...(seg.role === 'heading'
            ? { marginTop: afterHeading ? 0 : headingGapTop, marginBottom: headingGapBottom }
            : null),
          // Indents the item's text so every wrapped line lines up under the first. The "N." marker
          // is pulled out of flow, absolutely positioned into the gutter this padding opens, rather
          // than set with a negative text-indent, which would put it left of every other
          // paragraph's edge instead of flush with it.
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
              // Which highlight this span belongs to, by its first segment's doc id — the same id
              // HighlightGroup's `key` carries. A jump from the gutter or highlights panel
              // (useSuttaReading's scrollToSegment) centres on the highlighted text rather than on
              // the whole, possibly much longer, segment.
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
      {open && (
        <p
          className="animate-fadeUp"
          // --pw-hover backs .pw:hover (index.css). theme.tint rather than a fixed colour, so a
          // hovered Pali word stays a subtle wash against theme.pali in every theme.
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
            // Splits on whitespace and on a bare dash (lib/dictionary.ts's WORD_BOUNDARY). The dash
            // still renders — it is real text joining two words with no space — but as an inert
            // span, like whitespace, rather than a word that can be tapped up.
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
                  // Attribute names distinct from the ancestor's `data-seg`, which scrollToSegment
                  // queries, so ReaderPage's scrollToWordIfCovered can find this word's own rect
                  // without colliding with that per-segment query.
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
  onToggleSeg: (i: number) => void;
  // wordIndex is the tapped word's position among this segment's Pali tokens (lib/dictionary.ts's
  // splitPaliWords), so ReaderPage can step to the previous or next word from the DictionaryDock's
  // arrows without re-deriving it from the word text, which isn't unique within a segment.
  onWordClick: (word: string, segIndex: number, wordIndex: number) => void;
  onTextUp: () => void;
  onSpanClick: (i: number, s: number, e: number, rect: DOMRect, color: string) => void;
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

const EMPTY_HIGHLIGHTS: Highlight[] = [];

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
  // One line box at the current size and leading. Every vertical gap below is a fraction of it, so
  // the page's whole rhythm scales with both the Size and Line height reader controls rather than
  // being a fixed pixel value.
  const line = (fontSize * lineHeight) / 100;
  // Paragraph breaks sit a little under a full line: at a full line, baseline-to-baseline across a
  // break is exactly twice the leading, which at the airy end of the line-height scale reads as
  // disconnected blocks rather than one continuous text.
  const paragraphGap = Math.round(line * 0.8);
  // A section heading has to bind downward, to the section it opens. Its top margin therefore has
  // to beat the preceding paragraph's own bottom margin outright rather than add to it — adjacent
  // margins collapse to the larger of the two, so a heading carrying the same value as a paragraph
  // break would get no extra room at all.
  const headingGapTop = Math.round(line * 1.8);
  const headingGapBottom = Math.round(line * 0.6);
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
  // A list-item's ordinal within its run of consecutive list-item segments, reset to 0 whenever the
  // previous segment wasn't one, so a second list further down the sutta restarts at 1. Mutated in
  // iteration order inside the .map below rather than in a memoized pass of its own.
  let runningListIndex = 0;
  return (
    <div data-component="SegmentedText" data-segroot onMouseUp={onTextUp} onTouchEnd={onTextUp}>
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
            hlForSeg={highlightsBySeg.get(i) ?? EMPTY_HIGHLIGHTS}
            open={allPali || !!openSegs[i]}
            lastInParagraph={lastInParagraph}
            afterVerse={segments[i - 1]?.role === 'verse'}
            afterHeading={segments[i - 1]?.role === 'heading'}
            listIndex={seg.role === 'list-item' ? runningListIndex : undefined}
            focused={!!focusUid && seg.key.startsWith(`${focusUid}:`)}
            theme={theme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            face={face}
            paragraphGap={paragraphGap}
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
