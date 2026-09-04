import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { flattenListTree, type ListPathOption } from '../lib/lists';
import { searchKey } from '../lib/search/metadata';
import { matchRuns } from '../lib/search/match';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits';
import type { ThemeColors } from '../lib/types';

// The depth past which the indent stops growing, as ListRow caps it, so a deep tree can't squeeze
// row content off a narrow screen.
const MAX_INDENT_DEPTH = 3;

interface ListMembershipPickerProps {
  suttaId: string;
  theme: ThemeColors;
  autoFocus?: boolean;
  onRequestClose?: () => void;
}

type Row =
  // Browse mode only, and never selectable: activating a group expands or collapses its subtree.
  | { type: 'group'; option: ListPathOption }
  // `pinned` marks the copy in the checked-only section at the top; the list also appears in its
  // place in the tree below, and both rows toggle the one membership.
  | { type: 'list'; option: ListPathOption; pinned?: boolean }
  | { type: 'create'; name: string };

// The "add to lists" picker, with two modes in one popover as a label picker conventionally has:
//   empty input – browse: the lists this sutta is already in, flat at the top, then the whole tree
//                 indented by depth, its group rows expanding and collapsing
//   any input   – search: a flat ranked list of lists only, each naming its parent path, and a
//                 "Create list" row at the end
//
// Indentation and filtering are never mixed: a row lifted out of its subtree has no parent above
// it to be read against, so its path is spelled out instead. Groups drop out of the results, being
// unselectable, and only a top-level list can be created here — a group, or a list inside one, is
// the Library tree's job.
export function ListMembershipPicker({ suttaId, theme, autoFocus, onRequestClose }: ListMembershipPickerProps) {
  const { ready, lists, membership, toggleMembership, addToList, createList } = useUserData();
  const [draft, setDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Which groups are collapsed. Empty on every open, since a collapsed group could hide a list
  // this sutta is already in.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards a create already in flight against a double-tap or a held Enter, which would sail past
  // createList's own dedupe. A ref, since re-rendering mid-create would fight the input's focus.
  const creatingRef = useRef(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The real lists this sutta is in; an auto-list has nothing to add or remove against.
  const suttaListIds = (membership[suttaId] || []).filter((id) => !AUTO_LIST_IDS.has(id));
  // Membership as it stood when the picker opened, which is what the pinned section shows —
  // following live membership would make a row vanish from under the pointer as it was unchecked,
  // with no way back to it. Only the checkmarks follow. Snapshotted during render, so the first
  // paint carries the section, and keyed so a picker opened before the mirror loads doesn't freeze
  // an empty set.
  const [openMembership, setOpenMembership] = useState<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() });
  if (ready && openMembership.key !== suttaId) setOpenMembership({ key: suttaId, ids: new Set(suttaListIds) });
  const flatAll = useMemo(() => flattenListTree(lists), [lists]);
  const query = draft.trim();

  // Each list's ancestor path, for the dimmed text a lifted row carries. Walked rather than sliced
  // off the breadcrumb, a label being free to contain " / " itself.
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
      // The checked lists, repeated flat at the top in tree order, so they are among the first
      // rows rather than wherever their group falls.
      const pinned = flatAll.filter((f) => f.list.kind !== 'group' && openMembership.ids.has(f.list.id));
      // Everything under a collapsed group. `flatAll` is parent-then-children, so one forward pass
      // carries a collapse all the way down a subtree.
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
    // Matched against the whole breadcrumb, so a group's name still finds the lists inside it, and
    // folded with the same searchKey the library's search uses, so "a" finds "ā" here too.
    const ql = searchKey(query);
    const order = new Map(flatAll.map((f, i) => [f.list.id, i]));
    const matches = flatAll
      .filter((f) => f.list.kind !== 'group' && searchKey(f.breadcrumb).includes(ql))
      .sort((a, b) => {
        // A hit on the name outranks one only in the path, then the shorter name, then tree order.
        const aName = searchKey(a.list.label).includes(ql) ? 0 : 1;
        const bName = searchKey(b.list.label).includes(ql) ? 0 : 1;
        return aName - bName || a.list.label.length - b.list.label.length || order.get(a.list.id)! - order.get(b.list.id)!;
      });
    // The create row is offered even when something matched, a new name being free to be a
    // substring of an existing one; createList dedupes an exact repeat.
    return [
      ...matches.map((option) => ({ type: 'list' as const, option })),
      { type: 'create' as const, name: query.slice(0, LIST_NAME_MAX_LENGTH) },
    ];
  }, [query, flatAll, openMembership.ids, collapsed]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft]);

  // The cursor's row, clamped rather than stored back, so collapsing a group out from under it
  // lands on the last row rather than on nothing.
  const activeIdx = rows.length ? Math.min(activeIndex, rows.length - 1) : -1;

  // The row the section rule is drawn above, so the cursor can't land on it. -1 with nothing
  // pinned, and in search mode, which has no sections.
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
    // Only creating is guarded; toggling membership is idempotent, and twice is an on-then-off.
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const list = await createList(row.name, null, 'list');
      await addToList(suttaId, list);
      // Rebuilds the pinned section, so the new list joins it. The one action that does, and safe
      // here, the view going back from search to browse with no row under the pointer.
      setOpenMembership({ key: null, ids: new Set() });
    } catch (e) {
      // Both write to the local mirror and can't fail on the network, so only something
      // unexpected lands here; the guard still has to be released.
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
      // Stopped here, so the Escape that clears the draft doesn't also reach the reader's own
      // handler and close the panel in the same keypress.
      e.stopPropagation();
      if (draft) setDraft('');
      else onRequestClose?.();
    }
  }

  // One row's cursor styling. `tint` rather than `rule`, a border tone, which across a whole row
  // would read as a selection rather than a cursor.
  const rowStyle = (active: boolean) => ({
    borderRadius: 9,
    background: active ? theme.tint : 'transparent',
  });

  return (
    <div data-component="ListMembershipPicker" className="flex min-h-0 flex-1 flex-col">
      {/* The filter input, outside the scroll area rather than sticking to the top of it, so a row
          scrolling past ends at its edge — a sticky header pins to the scroller's padding box, and
          a host that padded the scroller left a strip above it where rows stayed visible. It has
          to stay on screen either way, focus living here while the arrows walk the rows, so hosts
          lay this out as a flex column and leave the scrolling to it. */}
      <div className="flex-none pb-1.5">
        {/* The rows' own 14.5px, so the input doesn't outweigh the list it filters — but 16px on a
            touch pointer, below which iOS Safari zooms the page on focus, and this app leaves
            pinch-zoom enabled rather than taking the `maximum-scale` escape. */}
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
      {/* `touch-pan-y` opts the rows back into scrolling, the Library's mobile modal setting
          `touch-none` on itself to keep a drag on its chrome from panning the page behind. */}
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
                  {/* Down while the group's lists show, right while they are hidden, as the tree
                      pane's own groups do. */}
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
          // True for a row lifted out of its subtree — a search result, or a pinned copy — which
          // is drawn flat and labelled with its path instead.
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
                  {/* The checkbox: filled in the accent when checked, as every other selected
                      state in the panel is, and outlined in `dim` when not. */}
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
