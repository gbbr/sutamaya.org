import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { flattenListTree, type ListPathOption } from '../lib/lists';
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
  | { type: 'list'; option: ListPathOption }
  | { type: 'create'; name: string };

// An "add to lists" widget with two distinct modes in one popover, the way a label/folder picker
// conventionally works:
//
//   empty input  -> browse: the whole list tree, indented by depth, with group rows that collapse
//                   and expand their subtree.
//   any input    -> search: a flat, ranked list of *lists only*, no indentation, each row naming
//                   its parent path in dimmed text, plus a single "Create list" row at the end.
//
// Indentation and filtering are never mixed: an indented row in a filtered list has no parent
// above it to be read against, so the path is spelled out instead. Groups drop out of the results
// entirely — they can't hold this sutta, so a group row there would be an unselectable row in a
// list whose whole purpose is selecting. Creating a *group*, or a list nested inside one, is the
// Library tree's job (see ListRow's inline create); this picker only ever creates a top-level
// list, which is the one thing it's open to do. Used by the reader's Lists tab.
export function ListMembershipPicker({ suttaId, theme, autoFocus, onRequestClose }: ListMembershipPickerProps) {
  const { ready, lists, membership, toggleMembership, addToList, createList } = useUserData();
  const [draft, setDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Collapsed groups, by id. Starts empty on every open — the picker is mounted fresh each time,
  // so nothing is ever collapsed when it appears. That's deliberate: a collapsed group would hide
  // a nested list this sutta is already in, and the whole point of opening this is to see where
  // the sutta currently sits.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards the create path against a double-tap (or a held Enter) while the POST is still out.
  // createList() dedupes by label against `lists`, which can't yet contain a list whose create
  // hasn't returned — so on a slow connection the second activation sails past that check and
  // creates a duplicate. A ref, not state: this only needs to suppress the redundant call, and
  // re-rendering the row mid-create would fight the input's own focus handling.
  const creatingRef = useRef(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // membership[suttaId] includes the "Highlights"/"Notes" auto-list ids (see
  // worker/src/routes/data.js's buildUserData) — those aren't real lists (no D1 row, no id to
  // add/remove items against), so they're excluded here rather than rendered as a toggleable
  // chip that would 404 against the API.
  const suttaListIds = (membership[suttaId] || []).filter((id) => !AUTO_LIST_IDS.has(id));
  // Membership as it stood when the picker opened, which is what the browse ordering below sorts
  // by. Sorting by *live* membership would re-rank the rows on every toggle, throwing the row
  // just tapped (and everything under it) somewhere else while the pointer is still on it — so
  // the order is frozen and only the checkmarks follow live membership. Snapshotted during
  // render rather than in an effect, so the first paint is already in its final order; keyed on
  // `ready` so a picker that opens before the mirror has loaded doesn't freeze an empty set, and
  // on `suttaId` so it re-snapshots if a host ever reuses this component across suttas.
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
      // Browsing: float whole root-subtrees that contained a member when the picker opened to the
      // top, so re-checking one you just added (to remove it, say) doesn't require typing its
      // name again — see `openMembership` above for why it's the snapshot. Reordering only
      // at the *root* level (not per-row) matters: flatAll is already in depth-first
      // parent-then-children order, so a plain per-row partition by membership would pull a nested
      // member list away from its own parent, floating it up alone with no visible parent above
      // it — this instead keeps every subtree's internal order intact and only moves whole
      // subtrees relative to each other. Array.sort is stable (ES2019+), so a same-root tie
      // (return 0) always preserves that original relative order.
      const rootOf = new Map<string, string>();
      for (const f of flatAll) {
        rootOf.set(f.list.id, f.depth === 0 ? f.list.id : (rootOf.get(f.list.parentId!) ?? f.list.id));
      }
      const rootHasMember = new Set<string>();
      for (const f of flatAll) {
        if (openMembership.ids.has(f.list.id)) rootHasMember.add(rootOf.get(f.list.id)!);
      }
      const sorted = [...flatAll].sort((a, b) => {
        const aRoot = rootOf.get(a.list.id)!;
        const bRoot = rootOf.get(b.list.id)!;
        if (aRoot === bRoot) return 0;
        return (rootHasMember.has(aRoot) ? 0 : 1) - (rootHasMember.has(bRoot) ? 0 : 1);
      });
      // Everything under a collapsed group drops out. Computed over flatAll rather than `sorted`
      // because it is in depth-first parent-then-children order, so one forward pass carries a
      // collapse all the way down a subtree.
      const hidden = new Set<string>();
      for (const f of flatAll) {
        const parentId = f.list.parentId;
        if (parentId && (collapsed.has(parentId) || hidden.has(parentId))) hidden.add(f.list.id);
      }
      return sorted
        .filter((option) => !hidden.has(option.list.id))
        .map((option) => ({ type: option.list.kind === 'group' ? ('group' as const) : ('list' as const), option }));
    }
    // Matching the whole breadcrumb, not just the label, so typing a group's name still finds the
    // lists inside it even though the group itself no longer appears as a row.
    const ql = query.toLowerCase();
    const order = new Map(flatAll.map((f, i) => [f.list.id, i]));
    const matches = flatAll
      .filter((f) => f.list.kind !== 'group' && f.breadcrumb.toLowerCase().includes(ql))
      .sort((a, b) => {
        // A hit on the list's own name outranks one that only matched somewhere in its path, then
        // the shorter name (the closer the match is to being the whole name), then tree order.
        const aName = a.list.label.toLowerCase().includes(ql) ? 0 : 1;
        const bName = b.list.label.toLowerCase().includes(ql) ? 0 : 1;
        return aName - bName || a.list.label.length - b.list.label.length || order.get(a.list.id)! - order.get(b.list.id)!;
      });
    // The create row is always offered, never only when nothing matched — a new list can
    // legitimately be a substring (or superstring) of an existing name (e.g. typing "Te" when
    // "Temp" already exists). createList() itself dedupes an exact same-label-same-parent create.
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
    // Only the create path is guarded — toggleMembership above is idempotent server-side
    // (ADD_ITEM_SQL/REMOVE_ITEM_SQL in routes/lists.js), and tapping a membership row twice is a
    // legitimate on-then-off, not something to swallow.
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const list = await createList(row.name, null, 'list');
      await addToList(suttaId, list);
      // Creating is the one action that *does* re-rank the rows: clearing the key makes the next
      // render re-snapshot from live membership, so the list just created floats to the top with
      // the rest. The view is being rebuilt from search back to browse anyway, so there's no row
      // under the pointer to yank away.
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
      // Stops here (doesn't bubble to the reader's own window-level Escape handler — see
      // ReaderPage) so a first Escape clearing the draft doesn't also skip straight to closing
      // the whole panel in the same keypress.
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
          className="w-full h-[38px] rounded-field px-3 text-[14.5px] [@media(pointer:coarse)]:text-base outline-none"
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
          if (row.type === 'create') {
            return (
              <button
                key="create"
                className="flex w-full items-center gap-2 px-2 py-[8px] text-left text-[14.5px]"
                style={{ ...rowStyle(active), borderTop: `1px solid ${theme.rule}`, borderRadius: 0, marginTop: 4, paddingTop: 12 }}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                <Plus size={13} strokeWidth={2} className="flex-none opacity-60" />
                <span className="min-w-0 truncate">Create list “{row.name}”</span>
              </button>
            );
          }
          const { list, depth } = row.option;
          if (row.type === 'group') {
            const isCollapsed = collapsed.has(list.id);
            return (
              <button
                key={list.id}
                className="flex w-full items-center gap-2 py-[8px] pr-2 text-left text-[14.5px]"
                style={{ ...rowStyle(active), paddingLeft: 8 + Math.min(depth, MAX_INDENT_DEPTH) * 14 }}
                aria-expanded={!isCollapsed}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                {/* Points down when the group's lists are showing, right when they're hidden —
                    matching the tree pane's own groups, which use a chevron rather than a folder
                    icon. */}
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className="flex-none opacity-50 transition-transform"
                  style={{ color: theme.fg, transform: isCollapsed ? 'rotate(-90deg)' : undefined }}
                />
                <span className="min-w-0 truncate" style={{ opacity: 0.65 }}>
                  {list.label}
                </span>
              </button>
            );
          }
          const checked = suttaListIds.includes(list.id);
          const parentPath = parentPathById.get(list.id) ?? '';
          return (
            <div
              key={list.id}
              className="flex items-center"
              style={{ ...rowStyle(active), paddingLeft: query ? 8 : 8 + Math.min(depth, MAX_INDENT_DEPTH) * 14 }}
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
                  {checked && <Check size={11} strokeWidth={3} color={theme.bg} />}
                </span>
                <MatchedLabel label={list.label} query={query} />
                {/* Search results are flat, so a nested list names its ancestors here instead of
                    being indented under them. `direction: rtl` puts the ellipsis at the *start*,
                    so a long path loses its root rather than the parent nearest this list; the
                    leading LRM keeps a path starting with a digit or punctuation from being
                    reordered by that. */}
                {query && parentPath && (
                  <span
                    className="ml-auto min-w-0 truncate font-sans text-[11.5px] opacity-50"
                    style={{ direction: 'rtl', textAlign: 'right' }}
                  >
                    {'‎' + parentPath}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The matched run in bold, so a result explains why it's a result. Only the first occurrence and
// only in the name: a match that landed in the parent path instead is already accounted for by
// the path shown beside it.
function MatchedLabel({ label, query }: { label: string; query: string }) {
  const at = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <span className="min-w-0 truncate text-[14.5px]">{label}</span>;
  return (
    <span className="min-w-0 truncate text-[14.5px]">
      {label.slice(0, at)}
      <strong className="font-semibold">{label.slice(at, at + query.length)}</strong>
      {label.slice(at + query.length)}
    </span>
  );
}
