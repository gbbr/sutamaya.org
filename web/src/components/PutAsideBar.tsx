import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, Layers, Trash2, TriangleAlert, X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useCorpus } from '../context/CorpusContext';
import { useLayout } from '../context/LayoutContext';
import { prefersReducedMotion } from '../lib/motion';
import { tuckJustStarted } from '../lib/putAsideTuck';
import { getUiScale } from '../lib/uiPrefs';
import { PUT_ASIDE_CAP, phoneTab, type PutAsideEntry } from '../lib/putAside';
import type { ThemeColors } from '../lib/types';

// The put-aside bar: the suttas set aside for later, and the one-tap way back into them.
//
// Drawn as the reader's header is, mirrored along the foot of the app — the page's own ground and
// one hairline rule along the top, no fill of its own and no cast shadow. The reader closes a sutta
// with a ⤓ up there and brings one back with a ⤒ down here, and the two rows read as the same
// piece of furniture.
//
// The tabs are set off from each other by a single hairline, not boxed. What marks the sutta on
// screen is a neutral wash a shade above the ground — no accent, no raised edge — and every other
// member lights faintly on hover. The Library holds no tab in hand, so nothing there is washed. So
// the set is always visible in full, and switching between tabs reads as a switch rather than as
// something taken away.
//
// It takes height from the app rather than floating over the text — a bar that costs layout space
// makes clearing it feel due once the topic is done, where a floating pill would only obstruct.
// Present while the set is non-empty, in the reader and the Library alike, except under an open
// dictionary, which takes the foot of the screen for itself.
//
// Every member carries its own ✕, the one on screen included, and that is the only way a sutta
// leaves the set: the reader's close button walks away from a reading without disturbing the bar
// below it.
//
// Nothing here is ever dropped to make room: at the cap the reader's minimise control opens the
// sheet asking which member should go, and the sutta they were reading takes the freed slot.
//
// Phone shows one — the last the reader left — plus a count onto the sheet; desktop spreads the set
// along the bar, collapsing whatever won't fit into one "+N" that opens the same sheet. Each keeps
// a legible minimum width rather than shrinking to fit, which reads as a row of slivers past two or
// three.

/** Height of the bar's own row, which the pages reserve. The safe-area inset sits under it. */
export const PUT_ASIDE_BAR_H = 44;

// What a desktop row may narrow to and grow to. They share whatever the bar has between those two
// figures, so a set of two reads generously and a set of five stays legible; past the point where
// they would all fall below the floor, the ones that don't fit collapse into the "+N". They stop
// at the ceiling rather than filling the bar — a pair of half-screen rows reads as a split view
// rather than as a set, and the empty run to their right is what says the set is small.
const TAB_MIN_W = 220;
const TAB_MAX_W = 320;
// Width of the trailing "+N", and of the phone's count.
const MORE_W = 52;
// The bar's own padding, both sides together, and the space between two members — the gap matching
// the room a tab leaves above and below itself, so the row reads as evenly set.
const BAR_PAD = 12;
const TAB_GAP = 4;

// The bar's entrance, and the sheet's. Matched to the prototype.
const SLIDE = 'cubic-bezier(.2,.8,.3,1)';
const SLIDE_MS = 300;

// True while the bar is on screen, so navigating between the Library and the reader doesn't replay
// its entrance on every route change — it slides up when the set appears, not when a page mounts.
let barWasShowing = false;

// The tabs the bar draws, oldest first and the newest always on it. The active tab is kept on the
// bar whatever else falls to the "+N": a browser never hides the tab you are looking at.
function desktopTabs(entries: PutAsideEntry[], room: number, currentSuttaId?: string): PutAsideEntry[] {
  if (entries.length <= room) return entries;
  const tail = entries.slice(-room);
  if (!currentSuttaId || tail.some((e) => e.suttaId === currentSuttaId)) return tail;
  const active = entries.find((e) => e.suttaId === currentSuttaId);
  return active ? [active, ...entries.slice(-(room - 1))] : tail;
}

/**
 * Whether the sheet listing the whole set is up, and what put it there. 'full' is the reader's
 * minimise control meeting the cap: the sheet says what has to give, and closing a tab there sets
 * the sutta on screen aside in its place.
 *
 * Owned by the page rather than the bar, the control that opens it in 'full' sitting up in the
 * reader's header.
 */
export type PutAsideSheetMode = 'closed' | 'open' | 'full';

/**
 * The sutta's ref, drawn as the Library's own rows draw it — bold, lightly letterspaced and muted,
 * a size below the title it leads. `size` is that size, the sheet's rows running larger than the
 * bar's tabs.
 */
function SuttaRef({ theme, label, size = 'text-ui-xs' }: { theme: ThemeColors; label: string; size?: string }) {
  return (
    <span className={`flex-none font-bold tracking-[.02em] ${size}`} style={{ color: theme.dim }}>
      {label}
    </span>
  );
}

interface Props {
  /** The surface's own palette — the reader's theme in the reader, the shell's in the Library. */
  theme: ThemeColors;
  /** The sutta being read, drawn as the active tab. Absent in the Library, where none is active. */
  currentSuttaId?: string;
  /** Opens a sutta in the reader, at the segment key the set remembered. */
  onOpen: (entry: PutAsideEntry) => void;
  sheet: PutAsideSheetMode;
  onSheet: (next: PutAsideSheetMode) => void;
  /**
   * Finishes the minimise the cap interrupted, once the reader has freed a slot in the 'full'
   * sheet. Absent in the Library, where nothing is being set aside.
   */
  onMakeRoom?: () => void;
}

export function PutAsideBar({ theme, currentSuttaId, onOpen, sheet, onSheet, onMakeRoom }: Props) {
  const { putAside, dropPutAside, clearPutAside } = useUserData();
  const { corpus } = useCorpus();
  const { mobile, w } = useLayout();

  // Closes the sheet once the set it lists is empty, so dismissing the last row doesn't leave an
  // empty sheet over a bar that has gone.
  useEffect(() => {
    if (!putAside.length && sheet !== 'closed') onSheet('closed');
  }, [putAside.length, sheet, onSheet]);

  // Whether this mount is the set appearing rather than a page changing under a bar already up.
  // Never while a tuck is on screen: there the card coming down is the bar's entrance, and a bar
  // sliding up to meet it both competes with it and moves the tab out from under its aim.
  const entering = useRef(!barWasShowing && !tuckJustStarted());
  useEffect(() => {
    barWasShowing = putAside.length > 0;
    return () => {
      // A page change unmounts and remounts the bar within the same tick, so "was showing" is left
      // as it stands and only an emptied set clears it.
      barWasShowing = putAside.length > 0;
    };
  }, [putAside.length]);

  if (!putAside.length) return null;

  // Switches to a tab. The set is untouched — the reading being left keeps no tab of its own
  // unless it already had one, which its own page sees to on the way out. Tapping the active tab is
  // left to do nothing: it is already what is on screen.
  const open = (entry: PutAsideEntry) => {
    onSheet('closed');
    if (entry.suttaId === currentSuttaId) return;
    onOpen(entry);
  };

  // Closes one tab. Asked for in the 'full' sheet it is the reader choosing what gives way, so the
  // minimise that opened the sheet goes through on the slot it just freed.
  const drop = (suttaId: string) => {
    dropPutAside(suttaId);
    if (sheet === 'full' && onMakeRoom) {
      onSheet('closed');
      onMakeRoom();
    }
  };

  const clearAll = () => {
    clearPutAside();
    if (sheet === 'full' && onMakeRoom) {
      onSheet('closed');
      onMakeRoom();
    }
  };

  const refOf = (suttaId: string) => corpus?.suttas[suttaId]?.ref ?? suttaId;
  const titleOf = (suttaId: string) => corpus?.suttas[suttaId]?.en ?? '';

  // How many members the bar shows: all of them where each still clears the minimum width,
  // otherwise as many as do beside the "+N" that carries the rest.
  //
  // `w` is the viewport in CSS pixels while the bar is laid out inside the document's own `zoom`
  // (Settings > UI scale), so its width in the units these figures are written in is that viewport
  // divided by the scale. Without the division a reader at 140% is offered five on a bar with room
  // for three. The leading control into the sheet comes off the top, desktop drawing it whatever
  // the set's size.
  const barW = w / getUiScale() - BAR_PAD - (mobile ? 0 : MORE_W);
  const fits = Math.max(1, Math.floor((barW + TAB_GAP) / (TAB_MIN_W + TAB_GAP)));
  const withMore = Math.max(1, Math.floor((barW - MORE_W) / (TAB_MIN_W + TAB_GAP)));
  const room = putAside.length <= fits ? putAside.length : withMore;
  // Trimmed from the front, so the tabs that fall to the "+N" are the oldest and the newest stays
  // on the bar. Phone shows the one tab that is the way back.
  const phone = phoneTab(putAside, currentSuttaId);
  const shown = mobile ? (phone ? [phone] : []) : desktopTabs(putAside, room, currentSuttaId);
  const hidden = putAside.length - shown.length;

  // The hover fill every member and chip shares — a wash fainter than the active tab's. Set as a
  // custom property rather than a class, the palette being a theme object rather than a stylesheet.
  const hoverable = { ['--hoverTint' as string]: theme.focusTint };

  // The sutta on screen, washed a shade above the ground. The fill is the whole of what marks it:
  // no accent, no raised edge, no shadow, no shape the others don't have. Only ever set in the
  // reader — the Library passes no tab in hand.
  const itemStyle = (suttaId: string) => ({
    ...hoverable,
    ...(suttaId === currentSuttaId ? { background: theme.tint } : {}),
  });

  const slideIn =
    entering.current && !prefersReducedMotion()
      ? { animation: `putAsideBarIn ${SLIDE_MS}ms ${SLIDE}` }
      : undefined;

  return (
    <>
      {/* Keyframes for the entrance, inline so the bar carries its own motion rather than adding a
          global rule for one component. */}
      <style>{`@keyframes putAsideBarIn{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes putAsideSheetIn{from{transform:translateY(102%)}to{transform:translateY(0)}}
@keyframes putAsideScrimIn{from{opacity:0}to{opacity:1}}`}</style>

      <div
        data-component="PutAsideBar"
        className="font-sans flex-none flex items-center gap-1 px-1.5"
        style={{
          // The row keeps its full height and the inset is clear space beneath it, so a home
          // indicator never crosses a tab. Zero wherever there is nothing to clear.
          height: `calc(${PUT_ASIDE_BAR_H}px + var(--safe-bottom))`,
          paddingBottom: 'var(--safe-bottom)',
          // The header's rule, mirrored: one hairline and the page's own ground. Nothing raises
          // this strip off the reading, because it is the same sheet of paper.
          borderTop: `1px solid ${theme.rule}`,
          backgroundColor: theme.bg,
          color: theme.fg,
          ...slideIn,
        }}
      >
        {mobile ? (
          // Phone: one — the last the reader left — and a count onto the sheet.
          <>
            <button
              data-put-aside-tab={shown[0].suttaId}
              className="relative flex-1 min-w-0 h-9 flex items-center gap-2.5 pl-2.5 pr-3 text-left hover:bg-[--hoverTint]"
              style={{
                ...itemStyle(shown[0].suttaId),
                // The strip's hairline bounds, dropped when this is the sutta in hand so its wash
                // reads unbroken.
                ...(shown[0].suttaId !== currentSuttaId
                  ? { borderLeft: `1px solid ${theme.rule}` }
                  : {}),
              }}
              onClick={() => open(shown[0])}
            >
              {/* Up out of the bar, the exact reverse of the ⤓ in the header putting it down into
                  one, and drawn at that control's own size. Dropped on the sutta already on
                  screen, which is not anywhere to go. */}
              {shown[0].suttaId !== currentSuttaId && (
                <ArrowUpFromLine size={19} strokeWidth={1.75} className="flex-none" style={{ color: theme.dim }} />
              )}
              <SuttaRef theme={theme} label={refOf(shown[0].suttaId)} />
              <span className="min-w-0 flex-1 truncate text-ui-sm">{titleOf(shown[0].suttaId)}</span>
            </button>
            <button
              className="flex-none h-9 flex items-center justify-center gap-1.5 px-2.5 text-ui-sm tabular-nums hover:bg-[--hoverTint]"
              style={{ color: theme.fg, ...hoverable }}
              aria-label={`Show all ${putAside.length} put aside`}
              title="Put aside"
              onClick={() => onSheet('open')}
            >
              <Layers size={15} strokeWidth={1.75} className="flex-none" />
              {putAside.length}
            </button>
          </>
        ) : (
          // Desktop: the set spread along the bar, behind the same way into the sheet the phone
          // leads with. A browser starts its tabs flush against the edge, but there the strip is
          // the whole interface; here the sheet holds what the bar can't — the count when members
          // have fallen to the "+N", and the only way to empty the set at all.
          <>
            <button
              className="flex-none h-9 flex items-center justify-center gap-1.5 px-2.5 text-ui-sm tabular-nums hover:bg-[--hoverTint]"
              style={{ color: theme.fg, ...hoverable }}
              aria-label={`Show all ${putAside.length} put aside`}
              title="Put aside"
              onClick={() => onSheet('open')}
            >
              <Layers size={15} strokeWidth={1.75} className="flex-none" />
              {putAside.length}
            </button>
            {shown.map((entry, i) => (
              <div
                key={entry.suttaId}
                data-put-aside-tab={entry.suttaId}
                // `group`, so a member's close button reveals on hovering anywhere along it — a
                // permanently visible ✕ on each reads as clutter across a full bar. The sutta on
                // screen keeps its own on show: it is the one the reader is holding, and this is
                // the only way out of the set.
                className="group relative flex-1 min-w-0 h-9 flex items-center hover:bg-[--hoverTint]"
                style={{
                  // Shares the bar with its siblings between these two, rather than taking a fixed
                  // width or filling whatever is left.
                  minWidth: TAB_MIN_W,
                  maxWidth: TAB_MAX_W,
                  // A hairline bounds the strip and sets each tab off from the next, dropped either
                  // side of the tab in hand so its wash reads as one unbroken block.
                  borderLeft: `1px solid ${
                    entry.suttaId !== currentSuttaId &&
                    (i === 0 || shown[i - 1].suttaId !== currentSuttaId)
                      ? theme.rule
                      : 'transparent'
                  }`,
                  borderRight: `1px solid ${
                    i === shown.length - 1 && entry.suttaId !== currentSuttaId ? theme.rule : 'transparent'
                  }`,
                  ...itemStyle(entry.suttaId),
                }}
              >
                <button className="flex-1 min-w-0 flex items-center gap-2 h-full pl-3 pr-1 text-left" onClick={() => open(entry)}>
                  <SuttaRef theme={theme} label={refOf(entry.suttaId)} />
                  <span className="min-w-0 flex-1 truncate text-ui-sm">{titleOf(entry.suttaId)}</span>
                </button>
                {/* On every member, the one on screen included: a sutta leaves the set here and
                    nowhere else, the reader's own close button leaving the set alone. */}
                <button
                  className={`flex-none flex items-center justify-center w-6 h-6 mr-1 rounded-full transition-opacity hover:bg-[--closeTint]${
                    entry.suttaId === currentSuttaId ? '' : ' opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
                  style={{ color: theme.dim, ['--closeTint' as string]: theme.tint }}
                  aria-label={`Close ${refOf(entry.suttaId)}`}
                  onClick={() => drop(entry.suttaId)}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
            {hidden > 0 && (
              <button
                className="flex-none h-9 flex items-center justify-center text-ui-sm tabular-nums hover:bg-[--hoverTint]"
                style={{ width: MORE_W, color: theme.dim, ...hoverable }}
                aria-label={`Show all ${putAside.length} put aside`}
                onClick={() => onSheet('open')}
              >
                +{hidden}
              </button>
            )}
          </>
        )}
      </div>

      {sheet !== 'closed' && (
        <PutAsideSheet
          entries={putAside}
          theme={theme}
          mode={sheet}
          currentSuttaId={currentSuttaId}
          refOf={refOf}
          titleOf={titleOf}
          onOpen={open}
          onDrop={drop}
          onClearAll={clearAll}
          onClose={() => onSheet('closed')}
        />
      )}
    </>
  );
}

interface SheetProps {
  entries: PutAsideEntry[];
  theme: ThemeColors;
  mode: PutAsideSheetMode;
  currentSuttaId?: string;
  refOf: (suttaId: string) => string;
  titleOf: (suttaId: string) => string;
  onOpen: (entry: PutAsideEntry) => void;
  onDrop: (suttaId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

// The whole set, each row carrying its position and its own way out. Square corners rather than
// the app's usual sheet radius, which reads too heavy at this height; no drag handle, nothing
// wiring up drag-to-dismiss; no excerpt line.
//
// Two icons, two meanings, kept apart: **✕ closes the sheet**, and **the bin removes from the
// set** — one row's, or every row's. A ✕ on the rows under a ✕ in the header would read as four
// ways to close the same thing.
//
// It lists every tab, the active one marked as the bar marks it and binned like any other. Opened
// at the cap it says so in place of the count, the bins being the way through rather than a tidy-up.
function PutAsideSheet({ entries, theme, mode, currentSuttaId, refOf, titleOf, onOpen, onDrop, onClearAll, onClose }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reduced = prefersReducedMotion();

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-component="PutAsideSheet">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,.28)', animation: reduced ? undefined : `putAsideScrimIn 240ms ease` }}
        onClick={onClose}
      />
      <div
        className="font-sans relative max-h-[76%] flex flex-col"
        style={{
          background: theme.panel,
          color: theme.fg,
          borderTop: `1px solid ${theme.rule}`,
          // Its ground runs to the edge of the screen; the inset holds the last row off a home
          // indicator.
          paddingBottom: 'var(--safe-bottom)',
          boxShadow: '0 -8px 30px rgb(0 0 0 / .16)',
          animation: reduced ? undefined : `putAsideSheetIn ${SLIDE_MS}ms ${SLIDE}`,
        }}
      >
        {/* No rule under the head, and none between the rows: the list reads as one block, with
            hover alone separating one row from the next. */}
        <div className="px-4 pt-3 pb-2">
          {/* Centred rather than on a shared baseline, so the title sits on the same line as the
              close button opposite it. */}
          <div className="flex items-center gap-2.5">
            <h3 className="flex min-w-0 items-center gap-1.5 text-ui-base font-semibold">
              <Layers size={15} strokeWidth={2} className="flex-none" />
              Put aside
            </h3>
            <span className="flex-none text-ui-sm" style={{ color: theme.dim }}>
              {entries.length} sutta{entries.length > 1 ? 's' : ''}
            </span>
            <button
              // `-mr-1` against the head's `px-4`: it puts this 36px button's centre 30px from the
              // sheet's edge, where the rows' bins sit under the list's own padding.
              className="ml-auto flex-none flex items-center justify-center w-9 h-9 -mr-1"
              style={{ color: theme.dim }}
              aria-label="Close"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="sc flex-1 min-h-0 px-1.5 pb-1.5">
          {entries.map((entry) => (
            <div
              key={entry.suttaId}
              className="relative flex items-stretch rounded-xl hover:bg-[--hoverTint]"
              style={{
                ['--hoverTint' as string]: theme.focusTint,
                // The active row, washed a shade above the sheet's ground exactly as its tab is.
                ...(entry.suttaId === currentSuttaId ? { background: theme.tint } : {}),
              }}
            >
              <button className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-3 text-left" onClick={() => onOpen(entry)}>
                {/* Auto-width, not a fixed column: the longest ref in the corpus (`AN11.992–1151`)
                    would otherwise set a column width every other row wastes. */}
                <SuttaRef theme={theme} label={refOf(entry.suttaId)} size="text-ui-sm" />
                <span className="min-w-0 flex-1 truncate text-ui-base">{titleOf(entry.suttaId)}</span>
              </button>
              <button
                className="flex-none self-center flex items-center justify-center w-9 h-9 mr-1.5 rounded-full hover:bg-[--binTint]"
                style={{ color: theme.dim, ['--binTint' as string]: theme.tint }}
                aria-label={`Dismiss ${refOf(entry.suttaId)}`}
                onClick={() => onDrop(entry.suttaId)}
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        {/* Nothing to explain about switching, which behaves as tabs do — just the way to empty
            the set, kept clear of the rows' own bins by the run of space before it, and at the cap
            the reason the reader is being asked to empty one. */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
          style={{ borderTop: `1px solid ${theme.rule}` }}
        >
          {mode === 'full' ? (
            <div className="min-w-0 flex-1 flex items-start gap-1.5 text-ui-sm" style={{ color: theme.warning }}>
              {/* Aligned to the first line rather than centred: the sentence wraps on a phone. */}
              <TriangleAlert size={14} strokeWidth={2} className="flex-none mt-[3px]" />
              <span className="min-w-0">
                You can set aside {PUT_ASIDE_CAP} suttas at a time. Remove one or more to make room.
              </span>
            </div>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <button
            className="flex-none flex items-center gap-2 text-ui-sm hover:opacity-70"
            style={{ color: theme.dim }}
            onClick={onClearAll}
          >
            <Trash2 size={15} strokeWidth={1.75} />
            Dismiss all
          </button>
        </div>
      </div>
    </div>
  );
}
