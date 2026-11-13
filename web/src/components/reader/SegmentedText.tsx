import { Fragment, memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { StickyNote } from 'lucide-react';
import type { SegmentFile, SegmentRole } from '../../lib/corpus/corpus';
import type { Highlight, ThemeColors } from '../../lib/types';
import { highlightPaint } from '../../lib/ui/theme';
import { expandHighlights, paintSegmentRanges, type SegmentRange } from '../../lib/highlights';
import { WORD_BOUNDARY, isWordBoundary } from '../../lib/corpus/dictionary';
import { runsOf, type Mark } from '../../lib/search/match';
import { opensHere } from '../../lib/navigation/linkClick';

interface Part {
  text: string;
  // Where the part begins in the segment's English.
  start: number;
  c?: string;
  id?: string;
  // Whether the part is where its highlight ends.
  end?: boolean;
}

// The stretches of a segment's lines an arriving search hit marks, as offsets into its English and
// its Pali.
export interface SegmentMarks {
  en: Mark[];
  pa: Mark[];
}

const NO_MARKS: Mark[] = [];

/** Where a segment's number shows: hanging in the left margin, or at the start of its line. */
export type SegmentNumberPlacement = 'margin' | 'inline';

/** Returns the section a segment key belongs to — its uid plus the digits before the first dot. */
function sectionOf(key: string): string {
  const colon = key.indexOf(':');
  const uid = key.slice(0, colon);
  const segId = key.slice(colon + 1);
  const dot = segId.indexOf('.');
  return dot === -1 ? uid : `${uid}:${segId.slice(0, dot)}`;
}

/**
 * Returns the paragraph a segment key belongs to, for a text that marks none — its key without the
 * last number, which in DN's three-level keys ("dn1:1.21.2") is a paragraph within a section.
 */
function paragraphOf(key: string): string {
  const colon = key.indexOf(':');
  const dot = key.lastIndexOf('.');
  return dot < colon ? key.slice(0, colon) : key.slice(0, dot);
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
function buildParts(text: string, rangesForSeg: SegmentRange[], key: string): Part[] {
  const parts: Part[] = [];
  let cur = 0;
  for (const { s, e, src } of paintSegmentRanges(rangesForSeg)) {
    if (s > cur) parts.push({ text: text.slice(cur, s), start: cur });
    parts.push({ text: text.slice(s, e), start: s, c: src.c, id: src.id, end: src.k1 === key && e === Math.min(src.o1, text.length) });
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

/**
 * NoteBadge marks a highlight carrying a note with a square badge on its top-right corner, out of
 * the text's flow. It renders inside the highlight's last span, whose click it shares.
 */
function NoteBadge({ paint, ring }: { paint: string; ring: string }) {
  return (
    // A zero-width anchor after the highlight's last character, marked as rendered text outside
    // `seg.en`, as the note number is.
    <span data-seg-ignore style={{ ...UNSELECTABLE, position: 'relative' }}>
      <span
        aria-hidden
        className="absolute flex items-center justify-center rounded-[3px] size-[0.9em]"
        // Centred on the corner the highlight's 2px spread draws.
        style={{ left: 2, top: -2, transform: 'translate(-50%,-50%)', background: paint, boxShadow: `0 0 0 1.5px ${ring}` }}
      >
        <StickyNote className="size-[0.6em]" strokeWidth={2.5} />
      </span>
    </span>
  );
}

// Type for a translator note's number, beside its line and at the head of the note; `top` raises
// it in place of the browser's `sup` raise, which would open up the line.
const NOTE_NUMBER: CSSProperties = {
  fontStyle: 'normal',
  fontWeight: 500,
  fontSize: '0.65em',
  verticalAlign: 'baseline',
  position: 'relative',
  top: '-0.55em',
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
  // The highlights carrying a note, each marked where it ends.
  notedIds: ReadonlySet<string>;
  showNotes: boolean;
  noteOpen: boolean;
  // The place of the segment's note among the sutta's notes, from 1.
  noteNumber?: number;
  onToggleNote: (i: number) => void;
  onNoteLink: (href: string) => void;
  onNoteLinkPress: (href: string) => void;
  // The word the DictionaryDock is showing, when it is in this segment.
  activeWordIndex: number | null;
  // Where the segment's number shows: hanging in the left margin, at the start of the line, or not
  // at all.
  segmentNumber?: SegmentNumberPlacement;
  onSegmentNumber: (i: number, extend: boolean) => void;
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
  notedIds,
  showNotes,
  noteOpen,
  noteNumber,
  onToggleNote,
  onNoteLink,
  onNoteLinkPress,
  activeWordIndex,
  segmentNumber,
  onSegmentNumber,
}: SegmentRowProps) {
  const parts = buildParts(seg.en, rangesForSeg, seg.key);
  const enMarks = marks ? mergedMarks(seg.en, marks.en) : NO_MARKS;
  const paMarks = marks ? mergedMarks(seg.pali, marks.pa) : NO_MARKS;
  /** linkedText renders a slice of the English with the translator's links and the search marks. */
  function linkedText(from: number, to: number, fill: string): ReactNode {
    const nodes: ReactNode[] = [];
    let at = from;
    for (const [start, end, href] of seg.links ?? []) {
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (a >= b) continue;
      if (at < a) nodes.push(<Fragment key={at}>{marked(seg.en.slice(at, a), at, enMarks, fill)}</Fragment>);
      nodes.push(
        <a
          key={a}
          className="text-link"
          href={href}
          onClick={(e) => {
            e.stopPropagation();
            if (!opensHere(e)) return;
            e.preventDefault();
            onNoteLink(href);
          }}
          onPointerDown={() => onNoteLinkPress(href)}
        >
          {marked(seg.en.slice(a, b), a, enMarks, fill)}
        </a>
      );
      at = b;
    }
    if (at < to) nodes.push(<Fragment key={at}>{marked(seg.en.slice(at, to), at, enMarks, fill)}</Fragment>);
    return nodes;
  }
  /** highlightedText renders a slice with highlights, links and search marks at their text offsets. */
  function highlightedText(from: number, to: number): ReactNode {
    const nodes = parts.map((p) => {
      const a = Math.max(from, p.start);
      const b = Math.min(to, p.start + p.text.length);
      if (a >= b) return null;
      if (!p.c) return <Fragment key={a}>{linkedText(a, b, theme.selection)}</Fragment>;
      const paint = highlightPaint(p.c, theme);
      return (
        <span
          key={a}
          // The id of the highlight this span was painted from, which useSuttaReading's
          // scrollToSegment jumps to. A highlight spanning several segments or blocks repeats it.
          data-hl-id={p.id}
          // The span stays selectable, unlike `.pw` and the note number, so a drag can cross or
          // extend an existing highlight. The text colour is theme.fg wherever the theme paints its
          // own fills, and a near-black otherwise.
          style={{
            background: paint,
            borderRadius: 2,
            boxShadow: `0 0 0 2px ${paint}`,
            color: theme.highlightPalette ? theme.fg : '#1B1917',
          }}
          onClick={(e) => {
            e.stopPropagation();
            // The span's own box, not that of a search mark inside it that took the click.
            onSpanClick(p.id!, e.currentTarget.getBoundingClientRect(), p.c!);
          }}
        >
          {linkedText(a, b, markOnHighlight(paint, theme))}
          {p.end && b === p.start + p.text.length && notedIds.has(p.id!) && <NoteBadge paint={paint} ring={theme.bg} />}
        </span>
      );
    });
    return <>
      {from === 0 && !paliLeads && listMarker}
      {from === 0 && !paliLeads && segmentNumberMark((enRoleStyle.fontSize as number | undefined) ?? enFontSize)}
      {nodes}
      {to === seg.en.length && seg.note && showNotes && (
        <sup
          // As the list-item marker: rendered text that isn't part of `seg.en`, so
          // useHighlightPopup's offsets discount it.
          data-seg-ignore
          className="font-sans"
          // Padding grows the number's tap target beyond its painted digits.
          style={{ ...NOTE_NUMBER, padding: '8px 8px 8px 4px', color: theme.pali, cursor: 'pointer', ...UNSELECTABLE }}
          title={stripTags(seg.note)}
          onClick={(e) => {
            e.stopPropagation();
            onToggleNote(i);
          }}
        >
          {noteNumber}
        </sup>
      )}
    </>;
  }
  /** speakerText styles source labels around highlights without changing the text's offsets. */
  function speakerText(from: number, to: number): ReactNode {
    const nodes: ReactNode[] = [];
    let at = from;
    for (const [start, end] of seg.speakers ?? []) {
      const a = Math.max(from, start), b = Math.min(to, end);
      if (a >= b) continue;
      if (at < a) nodes.push(<Fragment key={at}>{highlightedText(at, a)}</Fragment>);
      nodes.push(<span key={a} style={roleStyle('speaker', enFontSize, theme)}>{highlightedText(a, b)}</span>);
      at = b;
    }
    if (at < to) nodes.push(<Fragment key={at}>{highlightedText(at, to)}</Fragment>);
    return nodes;
  }
  /** englishText renders source blocks around inline highlights so a highlight cannot split a block. */
  function englishText(): ReactNode {
    const blocks: [number, number, 'heading' | NonNullable<SegmentFile['blocks']>[number][2]][] = [
      ...(seg.blocks ?? []),
      ...(seg.headings ?? []).map(([from, to]): [number, number, 'heading'] => [from, to, 'heading']),
    ];
    blocks.sort(([a], [b]) => a - b);
    // Text outside his blocks: in a line holding verse and a paragraph of his prose, the verse, ruled.
    const loose = (from: number, to: number) =>
      proseInVerse && seg.en.slice(from, to).trim() ? (
        <span key={from} style={{ display: 'block', ...verseRule }}>{speakerText(from, to)}</span>
      ) : (
        <Fragment key={from}>{speakerText(from, to)}</Fragment>
      );
    const nodes: ReactNode[] = [];
    let at = 0;
    for (let k = 0; k < blocks.length; k++) {
      const [from, to, kind] = blocks[k];
      if (at < from) nodes.push(loose(at, from));
      if (kind === 'list-item' || kind === 'indented-item') {
        const unbulleted = kind === 'indented-item';
        const items: ReactNode[] = [];
        let end = from;
        do {
          const [a, b] = blocks[k];
          if (end < a) items.push(<Fragment key={end}>{speakerText(end, a)}</Fragment>);
          items.push(<li key={a} style={{ marginBlock: unbulleted ? 0 : '0.2em', paddingInlineStart: unbulleted ? 0 : '0.15em' }}>{speakerText(a, b)}</li>);
          end = b;
          k++;
        } while (blocks[k]?.[2] === kind && !seg.en.slice(end, blocks[k][0]).trim());
        k--;
        nodes.push(
          <ul key={from} className="text-list" style={{
            listStyleType: unbulleted ? 'none' : 'disc', paddingInlineStart: '1.4em',
            margin: unbulleted ? 0 : '0.4em 0', whiteSpace: 'normal',
            ...(unbulleted && from > 0 ? { marginTop: paragraphGap } : null),
          }}>
            {items}
          </ul>
        );
        at = end;
      } else {
        nodes.push(kind === 'paragraph' ? (
          <p key={from} style={{ margin: 0, marginTop: from === 0 ? 0 : paragraphGap }}>{speakerText(from, to)}</p>
        ) : (
          <span
            key={from}
            className="font-sans"
            style={{ display: 'block', ...roleStyle('heading', enFontSize, theme), marginTop: headingGapTop, marginBottom: headingGapBottom }}
          >
            {speakerText(from, to)}
          </span>
        ));
        at = to;
      }
    }
    if (at < seg.en.length) nodes.push(loose(at, seg.en.length));
    return nodes;
  }
  // The segment's container: a heading, a block wrapper for source markup, or a plain paragraph.
  const HeadingTag = seg.role === 'heading'
    ? (`h${seg.headingLevel ?? 2}` as 'h2' | 'h3' | 'h4' | 'h5')
    : seg.blocks?.length || seg.headings?.length ? 'div' : 'p';
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
  const noteShown = showNotes && !!seg.note && noteOpen;
  // Whether the Pali line and the note fade in: as they open, never when the row mounts with them
  // open — a sutta returned to, or the row rebuilt inside the arrival wash.
  const [paliFades, setPaliFades] = useState(!open);
  if (!open && !paliFades) setPaliFades(true);
  const [noteFades, setNoteFades] = useState(!noteShown);
  if (!noteShown && !noteFades) setNoteFades(true);
  // A verse line also holding a paragraph of his prose, whose rule runs beside the verse alone.
  const proseInVerse = seg.role === 'verse' && !!seg.blocks?.some(([, , kind]) => kind === 'paragraph');
  // How far the segment's lines sit in from the column's edge: a verse's rule and indent, kept by a
  // speaker following it.
  const lineIndent = seg.role === 'verse' && !proseInVerse ? 16 : seg.role === 'speaker' && afterVerse ? 30 : 0;
  // The segment's number, for whichever of its lines comes first, set at `lineSize` px.
  const segmentNumberMark = (lineSize: number) =>
    segmentNumber && (
      <span
        // Rendered text that isn't part of `seg.en`, as the list marker above.
        data-seg-ignore
        className="font-sans"
        style={{
          fontSize: 12,
          fontWeight: 500,
          fontStyle: 'normal',
          fontVariantNumeric: 'tabular-nums',
          color: theme.dim,
          opacity: 0.75,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          ...UNSELECTABLE,
          // Placement, each with padding that grows the tap target past the glyphs:
          //   margin – left of the line and any verse rule, centred on its first row
          //   inline – leading the first row
          ...(segmentNumber === 'margin'
            ? {
                position: 'absolute',
                top: 0,
                right: `calc(100% + ${lineIndent + 14}px)`,
                padding: '0 4px',
                lineHeight: `${(lineSize * lineHeight) / 100}px`,
              }
            : { display: 'inline-block', lineHeight: 1, padding: '8px 4px', margin: '-8px 0.55em -8px -4px' }),
        }}
        // Keeps a Shift-click from stretching the text selection to the number.
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSegmentNumber(i, e.shiftKey);
        }}
      >
        {seg.key.slice(seg.key.indexOf(':') + 1)}
      </span>
    );
  const paliLine = open && (
    <p
      className={paliFades ? 'animate-fadeUp' : undefined}
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
          ...(above && segmentNumber === 'margin' ? { position: 'relative' } : null),
        } as CSSProperties
      }
    >
      {above && listMarker}
      {above && segmentNumberMark(fontSize)}
      {paliWordSpans(seg.pali, i, activeWordIndex, paMarks, theme, onWordClick)}
    </p>
  );
  // True when a Pali line is actually rendered above the English, not merely requested.
  const paliLeads = above && !!paliLine;
  const enFontSize = paliLeads ? glossFontSize : fontSize;
  const enRoleStyle = roleStyle(seg.role, enFontSize, theme, seg.headingLevel);
  // A verse's indent and rule, which a speaker attribution following a verse keeps.
  const verseRule =
    seg.role === 'verse' ? { paddingLeft: 14, borderLeft: `2px solid ${theme.rule}` }
    : seg.role === 'speaker' && afterVerse ? { paddingLeft: 28, borderLeft: `2px solid ${theme.rule}` }
    : undefined;
  const lines = (
    <>
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
          whiteSpace: 'pre-line',
          color: theme.fg,
          ...(seg.role === 'heading' ? null : { fontFamily: face }),
          ...enRoleStyle,
          ...(segmentNumber === 'margin' ? { position: 'relative' } : null),
          ...(seg.role === 'heading'
            ? { marginTop: paliLeads || afterHeading ? 0 : headingGapTop, marginBottom: headingGapBottom }
            : null),
          // A list item's hanging indent: wrapped lines align under the first, and the "N." marker
          // sits in the gutter this padding opens.
          ...(seg.role === 'list-item' ? { paddingLeft: 24, position: 'relative' } : null),
        } as CSSProperties}
      >
        {englishText()}
      </HeadingTag>
      {!above && paliLine}
      {showNotes && seg.note && noteOpen && (
        <p
          className={noteFades ? 'animate-fadeUp' : undefined}
          data-reveal="note"
          data-reveal-seg={i}
          style={{ margin: '0 0 6px', fontSize: Math.max(11, fontSize - 3), lineHeight: 1.5, fontFamily: face, color: theme.dim }}
          // A link to another sutta opens it in the reader, unless a modifier asks the browser for
          // a new tab.
          onClick={(e) => {
            const link = (e.target as Element).closest('a');
            if (!link || !opensHere(e)) return;
            e.preventDefault();
            onNoteLink(link.getAttribute('href') ?? '');
          }}
          onPointerDown={(e) => {
            const link = (e.target as Element).closest('a');
            if (link) onNoteLinkPress(link.getAttribute('href') ?? '');
          }}
        >
          <sup className="font-sans" style={{ ...NOTE_NUMBER, marginRight: 3, ...UNSELECTABLE }}>
            {noteNumber}
          </sup>
          <span
            // A note's inline formatting is static build-time data (build-corpus.mjs's cleanNote()),
            // never user or runtime content.
            dangerouslySetInnerHTML={{ __html: seg.note }}
          />
        </p>
      )}
    </>
  );
  return (
    <div id={seg.key} style={{ marginBottom: lastInParagraph ? paragraphGap : 0, ...(seg.speaker || proseInVerse ? null : verseRule) }}>
      {seg.speaker && (
        // The translator's label naming who speaks the line, above it and outside a verse's rule.
        <p
          style={{
            margin: 0,
            cursor: 'pointer',
            fontFamily: face,
            lineHeight: lineHeight / 100,
            ...roleStyle('speaker', enFontSize, theme),
            ...UNSELECTABLE,
          }}
          onClick={() => {
            if (String(window.getSelection())) return;
            onToggleSeg(i);
          }}
        >
          {seg.speaker}
        </p>
      )}
      {seg.speaker ? <div style={proseInVerse ? undefined : verseRule}>{lines}</div> : lines}
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
  // The highlights carrying a note.
  notedIds?: ReadonlySet<string>;
  // Whether the translator-note numbers show at all.
  showNotes: boolean;
  // Which notes are expanded inline, by segment index.
  openNotes: Record<number, boolean>;
  onToggleNote: (i: number) => void;
  // Called with the href of a link tapped in a note.
  onNoteLink: (href: string) => void;
  // Called with the href of a link in a note as it is pressed, before the tap completes.
  onNoteLinkPress: (href: string) => void;
  // The word currently shown in the DictionaryDock, or null.
  activeWord: { segIndex: number; wordIndex: number } | null;
  // The first and last segment of the passage the reader arrived at, washed.
  washRange?: [number, number];
  // Whether the reader's tap has lifted the wash, which fades out; its block stays, so the rows
  // inside aren't remounted.
  washLifted?: boolean;
  // The arrival the wash belongs to, so arriving again at the same passage washes it again.
  washId?: string;
  // What an arriving search hit marks, by segment index.
  marks?: Map<number, SegmentMarks>;
  // Where each segment's number shows, when segment numbers are on.
  segmentNumbers?: SegmentNumberPlacement;
  // Called with the segment whose number was tapped, and whether Shift was held.
  onSegmentNumber: (i: number, extend: boolean) => void;
}

const EMPTY_RANGES: SegmentRange[] = [];
const NO_NOTED: ReadonlySet<string> = new Set();

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
  notedIds = NO_NOTED,
  showNotes,
  openNotes,
  onToggleNote,
  onNoteLink,
  onNoteLinkPress,
  activeWord,
  washRange,
  washLifted,
  washId,
  marks,
  segmentNumbers,
  onSegmentNumber,
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
  // Whether the text marks where its printed paragraphs end; a copy cached without the marks breaks
  // them at its segment numbers instead.
  const printedParagraphs = useMemo(() => segments.some((s) => s.pe), [segments]);
  // A list item's ordinal within its run of consecutive list-item segments, reset to 0 by any
  // other segment so a later list restarts at 1.
  let runningListIndex = 0;
  // The latest translator note's number, counted through the sutta from 1.
  let runningNoteNumber = 0;
  const rows = segments.map((seg, i) => {
    // A paragraph break: the next segment is in another paragraph, or there is none. A heading,
    // whose own margin is the space below it, ends one only with its section.
    const next = segments[i + 1];
    const lastBlock = seg.blocks?.at(-1);
    const firstBlock = next?.blocks?.[0];
    const continuesIndentedList = lastBlock?.[2] === 'indented-item' && lastBlock[1] === seg.en.length
      && firstBlock?.[2] === 'indented-item' && firstBlock[0] === 0;
    const lastInParagraph =
      !continuesIndentedList && (!next ||
      (seg.role === 'heading' ? sectionOf(next.key) !== sectionOf(seg.key)
        : printedParagraphs ? !!seg.pe : paragraphOf(next.key) !== paragraphOf(seg.key)));
    runningListIndex = seg.role === 'list-item' ? runningListIndex + 1 : 0;
    if (seg.note) runningNoteNumber += 1;
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
        notedIds={notedIds}
        showNotes={showNotes}
        noteOpen={!!openNotes[i]}
        noteNumber={seg.note ? runningNoteNumber : undefined}
        onToggleNote={onToggleNote}
        onNoteLink={onNoteLink}
        onNoteLinkPress={onNoteLinkPress}
        activeWordIndex={activeWord && activeWord.segIndex === i ? activeWord.wordIndex : null}
        segmentNumber={segmentNumbers}
        onSegmentNumber={onSegmentNumber}
      />
    );
  });
  return (
    <div data-component="SegmentedText" data-segroot>
      {washRange ? (
        <>
          {rows.slice(0, washRange[0])}
          {/* The arrival wash, tinted out to the reading pane's edges, which clip the shadow; keyed
              by its arrival and range, so each new arrival washes afresh. */}
          <div
            key={`${washId}:${washRange.join('-')}`}
            className="arrival-wash"
            data-wash-block={!washLifted || undefined}
            style={{
              backgroundColor: washLifted ? 'transparent' : theme.focusTint,
              boxShadow: `0 0 0 100vmax ${washLifted ? 'transparent' : theme.focusTint}`,
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
