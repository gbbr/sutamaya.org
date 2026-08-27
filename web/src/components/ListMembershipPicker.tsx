import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { flattenListTree, type ListPathOption } from '../lib/lists';
import { searchKey } from '../lib/corpus';
import { matchRuns } from '../lib/searchMatch';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits';
import type { ThemeColors } from '../lib/types';

// Matches ListRow's own cap (see its MAX_INDENT_DEPTH) — nesting itself is unlimited, but the
// indent stops growing past this depth so a deep tree can't squeeze row content off a narrow
// screen.
const MAX_INDENT_DEPTH = 3;

interface ListMembershipPickerProps {
  suttaId: string;
  theme: ThemeColors;
  autoFocus?: boolean;
  onRequestClose?: () => void;
}

type Row =
  // Browse mode only: a group can't hold a sutta, so activating one collapses or expands its
  // subtree rather than selecting anything.
  | { type: 'group'; option: ListPathOption }
  // `pinned` marks a copy in the browse mode's checked-only section at the top; the same list also
  // appears in its place in the tree below, and both rows toggle the one membership.
  | { type: 'list'; option: ListPathOption; pinned?: boolean }
  | { type: 'create'; name: string };

// An "add to lists" widget with two distinct modes in one popover, the way a label/folder picker
// conventionally works:
//
//   empty input  -> browse: the lists this sutta is already in, flat and unindented at the top,
//                   then a rule, then the whole list tree indented by depth, with group rows that
//                   collapse and expand their subtree.
//   any input    -> search: a flat, ranked list of *lists only*, no indentation, each row naming
//                   its parent path in dimmed text, plus a single "Create list" row at the end.
//
// Indentation and filtering are never mixed: a row lifted out of its subtree — a search result, or
// a checked row pinned to the top — has no parent above it to be read against, so its path is
// spelled out instead. Groups drop out of the results entirely, since they can't hold this sutta
// and would be unselectable rows in a list whose purpose is selecting. Creating a group, or a list
// nested inside one, is the Library tree's job (ListRow's inline create); this picker only creates
// a top-level list. Used by the reader's Lists tab.
export function ListMembershipPicker({ suttaId, theme, autoFocus, onRequestClose }: ListMembershipPickerProps) {
  const { ready, lists, membership, toggleMembership, addToList, createList } = useUserData();
  const [draft, setDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Collapsed groups, by id. Empty on every open, since the picker mounts fresh: a collapsed group
  // would hide a nested list this sutta is already in, which is what opening this is for.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards the create path against a double-tap or a held Enter while the POST is still out.
  // createList() dedupes by label against `lists`, which can't yet hold a list whose create hasn't
  // returned, so on a slow connection a second activation would sail past that check. A ref rather
  // than state: re-rendering the row mid-create would fight the input's focus handling.
  const creatingRef = useRef(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // membership[suttaId] includes the auto-list ids, which are synthesized rather than real rows and
  // have nothing to add or remove items against, so they're excluded rather than rendered as a
  // toggle that would 404.
  const suttaListIds = (membership[suttaId] || []).filter((id) => !AUTO_LIST_IDS.has(id));
  // Membership as it stood when the picker opened, which fills the pinned section below. Live
  // membership would make a row vanish from under the pointer the moment it was unchecked, with no
  // way to undo a mistaken tap short of finding the list again, so the section is frozen and only
  // the checkmarks follow live membership. Snapshotted during render rather than in an effect, so
  // the first paint carries the section; keyed on `ready` so a picker opened before the mirror
  // loads doesn't freeze an empty set, and on `suttaId` in case a host reuses the component.
  const [openMembership, setOpenMembership] = useState<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() });
  if (ready && openMembership.key !== suttaId) setOpenMembership({ key: suttaId, ids: new Set(suttaListIds) });
  const flatAll = useMemo(() => flattenListTree(lists), [lists]);
  const query = draft.trim();

  // Ancestor chain per list, for the dimmed path a search result carries. Walked from each list
  // rather than sliced off its breadcrumb string, since a label is free to contain " / " itself.
  const parentPathById = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));
    const out = new Map<string, string>();
    for (const l of lists) {
      const parts: string[] = [];
      let cur = l.parentId ? byId.get(l.parentId) : undefined;
      while (cur) {
        parts.unshift(cur.label);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      out.set(l.id, parts.join(' / '));
    }
    return out;
  }, [lists]);

  const rows: Row[] = useMemo(() => {
    if (!query) {
      // Browsing: the lists this sutta was in when the picker opened, lifted out of the tree and
      // repeated flat at the top, so the checked ones are among the first rows rather than wherever
      // their group falls — which in a deep tree can be well below the fold. They keep their tree
      // order and name their parent path, a lifted row having no parent above it. The tree below
      // stays in plain depth-first order, which is the layout the user already knows.
      const pinned = flatAll.filter((f) => f.list.kind !== 'group' && openMembership.ids.has(f.list.id));
      // Everything under a collapsed group drops out. flatAll is in depth-first
      // parent-then-children order, so one forward pass carries a collapse all the way down a
      // subtree.
      const hidden = new Set<string>();
      for (const f of flatAll) {
        const parentId = f.list.parentId;
        if (parentId && (collapsed.has(parentId) || hidden.has(parentId))) hidden.add(f.list.id);
      }
      return [
        ...pinned.map((option) => ({ type: 'list' as const, option, pinned: true })),
        ...flatAll
          .filter((option) => !hidden.has(option.list.id))
          .map((option) => ({ type: option.list.kind === 'group' ? ('group' as const) : ('list' as const), option })),
      ];
    }
    // Matching the whole breadcrumb, not just the label, so typing a group's name still finds the
    // lists inside it even though the group itself no longer appears as a row. Folded with
    // searchKey, the same key library search matches on, so "a" finds "ā" here too.
    const ql = searchKey(query);
    const order = new Map(flatAll.map((f, i) => [f.list.id, i]));
    const matches = flatAll
      .filter((f) => f.list.kind !== 'group' && searchKey(f.breadcrumb).includes(ql))
      .sort((a, b) => {
        // A hit on the list's own name outranks one that only matched somewhere in its path, then
        // the shorter name (the closer the match is to being the whole name), then tree order.
        const aName = searchKey(a.list.label).includes(ql) ? 0 : 1;
        const bName = searchKey(b.list.label).includes(ql) ? 0 : 1;
        return aName - bName || a.list.label.length - b.list.label.length || order.get(a.list.id)! - order.get(b.list.id)!;
      });
    // The create row is always offered, not only when nothing matched: a new list can legitimately
    // be a substring of an existing name — typing "Te" when "Temp" exists. createList() dedupes an
    // exact same-label, same-parent create.
    return [
      ...matches.map((option) => ({ type: 'list' as const, option })),
      { type: 'create' as const, name: query.slice(0, LIST_NAME_MAX_LENGTH) },
    ];
  }, [query, flatAll, openMembership.ids, collapsed]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft]);

  // Clamped rather than stored back, so collapsing a group out from under the cursor lands it on
  // the last row instead of on nothing.
  const activeIdx = rows.length ? Math.min(activeIndex, rows.length - 1) : -1;

  // Where the pinned section ends and the tree begins — the rule is drawn above that row rather
  // than as a row of its own, so the keyboard cursor can't land on it. -1 when nothing is pinned,
  // and in search mode, which has no section.
  const firstTreeRow = rows.findIndex((r) => r.type !== 'list' || !r.pinned);
  const dividerAt = firstTreeRow > 0 ? firstTreeRow : -1;

  function step(delta: number) {
    setActiveIndex(Math.min(rows.length - 1, Math.max(0, activeIdx + delta)));
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function activateRow(row: Row) {
    if (row.type === 'group') {
      toggleCollapsed(row.option.list.id);
      return;
    }
    if (row.type === 'list') {
      toggleMembership(suttaId, row.option.list.id);
      return;
    }
    // Only the create path is guarded: toggleMembership is idempotent server-side
    // (ADD_ITEM_SQL/REMOVE_ITEM_SQL in routes/lists.js), and tapping a membership row twice is a
    // legitimate on-then-off.
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const list = await createList(row.name, null, 'list');
      await addToList(suttaId, list);
      // Creating is the one action that rebuilds the pinned section: clearing the key makes the
      // next render re-snapshot from live membership, so the new list joins it. The view is going
      // from search back to browse anyway, so there is no row under the pointer to yank away.
      setOpenMembership({ key: null, ids: new Set() });
    } catch (e) {
      // Both write to the local mirror and can't fail on the network, so this only catches
      // something genuinely unexpected — enough to release the re-entrancy guard below.
      console.error('list create failed', e);
    } finally {
      creatingRef.current = false;
    }
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) activateRow(row);
    } else if (e.key === 'Escape') {
      // Stops here rather than bubbling to the reader's window-level Escape handler, so a first
      // Escape clearing the draft doesn't also close the whole panel in the same keypress.
      e.stopPropagation();
      if (draft) setDraft('');
      else onRequestClose?.();
    }
  }

  // `tint`, not `rule` — `rule` is a border tone, and spread across a whole row it reads as a
  // selected row rather than as the pointer/keyboard cursor it actually is.
  const rowStyle = (active: boolean) => ({
    borderRadius: 9,
    background: active ? theme.tint : 'transparent',
  });

  return (
    <div data-component="ListMembershipPicker" className="flex min-h-0 flex-1 flex-col">
      {/* The input sits outside the scroll area rather than sticking to the top of it, so a row
          scrolling past simply ends at the field's edge with nothing showing above it. (A sticky
          header pins to its scroller's *padding* box, so every host that padded the scroller left
          a strip above the field where the rows stayed visible.) It has to stay on screen either
          way: focus lives in the input while ArrowUp/Down walks the rows, so it's the control the
          user is actually driving. Hosts therefore lay this component out as a flex column of its
          own height and leave the scrolling to it. */}
      <div className="flex-none pb-1.5">
        {/* Matches the rows' own 14.5px, so the input doesn't read as a heavier element than the
            list it filters — except on a touch pointer, where it goes back to 16px: iOS Safari
            zooms the whole page when an input with a smaller font takes focus, and
            web/index.html deliberately leaves pinch-zoom enabled, so the usual `maximum-scale`
            escape isn't open to us. The 16px only ever applies where that zoom is a risk. */}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search or create a list"
          className="w-full h-[38px] rounded-field px-3 text-ui-md outline-none"
          style={{ border: `1px solid ${theme.pali}`, background: theme.bg, color: theme.fg }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      {/* `touch-pan-y`: the Library's mobile modal sets `touch-none` on itself to keep a drag on
          its chrome from panning the page behind it, so the rows have to opt back in here. */}
      <div className="sc min-h-0 flex-1 touch-pan-y">
        {rows.map((row, idx) => {
          const active = idx === activeIdx;
          const sep = idx === dividerAt ? <div className="mx-2 mb-1.5 mt-1" style={{ borderTop: `1px solid ${theme.rule}` }} /> : null;
          if (row.type === 'create') {
            return (
              <button
                key="create"
                className="flex w-full items-center gap-2 px-2 py-[8px] text-left text-ui-md"
                style={{ ...rowStyle(active), borderTop: `1px solid ${theme.rule}`, borderRadius: 0, marginTop: 4, paddingTop: 12 }}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                <Plus size={16} strokeWidth={2} className="flex-none opacity-60" />
                <span className="min-w-0 truncate">Create list “{row.name}”</span>
              </button>
            );
          }
          const { list, depth } = row.option;
          if (row.type === 'group') {
            const isCollapsed = collapsed.has(list.id);
            return (
              <Fragment key={list.id}>
                {sep}
                <button
                  className="flex w-full items-center gap-2 py-[8px] pr-2 text-left text-ui-md"
                  style={{ ...rowStyle(active), paddingLeft: 8 + Math.min(depth, MAX_INDENT_DEPTH) * 14 }}
                  aria-expanded={!isCollapsed}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => activateRow(row)}
                >
                  {/* Points down when the group's lists are showing, right when they're hidden —
                      matching the tree pane's own groups, which use a chevron rather than a folder
                      icon. */}
                  <ChevronDown
                    size={17}
                    strokeWidth={2}
                    className="flex-none opacity-50 transition-transform"
                    style={{ color: theme.fg, transform: isCollapsed ? 'rotate(-90deg)' : undefined }}
                  />
                  <span className="min-w-0 truncate" style={{ opacity: 0.65 }}>
                    {list.label}
                  </span>
                </button>
              </Fragment>
            );
          }
          const checked = suttaListIds.includes(list.id);
          const parentPath = parentPathById.get(list.id) ?? '';
          // Flat and path-labelled in both the modes that lift a row out of its subtree: a search
          // result and a pinned copy of a checked list.
          const flat = Boolean(query) || Boolean(row.pinned);
          return (
            <Fragment key={row.pinned ? `pin:${list.id}` : list.id}>
              {sep}
              <div
                className="flex items-center"
                style={{ ...rowStyle(active), paddingLeft: flat ? 8 : 8 + Math.min(depth, MAX_INDENT_DEPTH) * 14 }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <button className="flex flex-1 min-w-0 items-center gap-2 py-[8px] pr-2 text-left" onClick={() => activateRow(row)}>
                  {/* Checked fills with the theme's accent rather than with full-strength `fg`,
                      matching every other selected state in the reader's panel; unchecked draws in
                      `dim` rather than `fg`, which at 16px read as a heavier mark than the name
                      beside it. */}
                  <span
                    className="flex-none w-[16px] h-[16px] rounded-[5px] flex items-center justify-center"
                    style={{
                      border: `1px solid ${checked ? theme.pali : theme.dim}`,
                      background: checked ? theme.pali : 'transparent',
                    }}
                  >
                    {checked && <Check size={14} strokeWidth={3} color={theme.bg} />}
                  </span>
                  <MatchedLabel label={list.label} query={query} />
                  {/* A flat row names its ancestors here instead of being indented under them.
                      `direction: rtl` puts the ellipsis at the *start*, so a long path loses its
                      root rather than the parent nearest this list; the leading LRM keeps a path
                      starting with a digit or punctuation from being reordered by that.
                      `max-w-[45%]`, with the label taking the rest (see MatchedLabel's `flex-1`),
                      is what keeps the two apart when both are long: the name truncates against a
                      path that can never claim more than its share, rather than the pair shrinking
                      each other into a few characters apiece. */}
                  {flat && parentPath && (
                    <span
                      className="flex-none max-w-[45%] truncate font-sans text-ui-xs opacity-50"
                      style={{ direction: 'rtl', textAlign: 'right' }}
                    >
                      {'‎' + parentPath}
                    </span>
                  )}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// The matched runs in bold, so a result explains why it is one. Only in the name: a match in the
// parent path is already accounted for by the path shown beside it. matchRuns does the marking, so
// the bolding folds diacritics exactly the way the filter above did — typing "a" bolds an "ā".
function MatchedLabel({ label, query }: { label: string; query: string }) {
  const runs = matchRuns(label, query);
  return (
    <span className="min-w-0 flex-1 truncate text-ui-md">
      {runs.map((run, i) =>
        run.hit ? (
          <strong key={i} className="font-semibold">
            {run.text}
          </strong>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        )
      )}
    </span>
  );
}
