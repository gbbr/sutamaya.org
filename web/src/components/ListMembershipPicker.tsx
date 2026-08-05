import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { flattenListTree, resolveListById, type ListPathOption } from '../lib/lists';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import type { ListDef, ThemeColors } from '../lib/types';

interface ListMembershipPickerProps {
  suttaId: string;
  theme: ThemeColors;
  autoFocus?: boolean;
  onRequestClose?: () => void;
}

type Row =
  | { type: 'list'; option: ListPathOption }
  | { type: 'create-top'; name: string }
  | { type: 'create-nested'; name: string; parentId: string; parentLabel: string };

// A single-input, multi-select "add to lists" widget: type to filter, Enter toggles membership
// on the highlighted row without closing, Shift+Enter/Tab on a highlighted list nests a new list
// inside it, and "Parent / New name" typed directly does the same without needing the shortcut.
// Shared by the reader's Lists tab and (eventually) the preview pane's "In lists" editor, so both
// get the same fast add-to-multiple-lists flow instead of two hand-rolled pickers.
export function ListMembershipPicker({ suttaId, theme, autoFocus, onRequestClose }: ListMembershipPickerProps) {
  const { lists, membership, toggleMembership, addToList, createList } = useUserData();
  const [draft, setDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [nestingParent, setNestingParent] = useState<ListDef | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // membership[suttaId] includes the "Highlights"/"Notes" auto-list ids (see
  // server/src/routes/data.js's buildUserData) — those aren't real lists (no Firestore doc, no
  // id to add/remove items against), so they're excluded here rather than rendered as a
  // toggleable chip that would 404 against the server.
  const suttaListIds = (membership[suttaId] || []).filter((id) => !AUTO_LIST_IDS.has(id));
  const flatAll = useMemo(() => flattenListTree(lists), [lists]);

  const rows: Row[] = useMemo(() => {
    if (nestingParent) {
      const name = draft.trim();
      return name ? [{ type: 'create-nested', name, parentId: nestingParent.id, parentLabel: nestingParent.label }] : [];
    }
    const q = draft.trim();
    if (!q) {
      // Browsing (nothing typed): float whole root-subtrees that contain a member to the top,
      // so re-checking one you just added (to remove it, say) doesn't require typing its name
      // again. Reordering only at the *root* level (not per-row) matters: flatAll is already in
      // depth-first parent-then-children order, so a plain per-row partition by membership would
      // pull a nested member list away from its own parent, floating it up alone with no visible
      // parent above it — this instead keeps every subtree's internal order intact and only
      // moves whole subtrees relative to each other. Array.sort is stable (ES2019+), so a
      // same-root tie (return 0) always preserves that original relative order.
      const rootOf = new Map<string, string>();
      for (const f of flatAll) {
        rootOf.set(f.list.id, f.depth === 0 ? f.list.id : (rootOf.get(f.list.parentId!) ?? f.list.id));
      }
      const rootHasMember = new Set<string>();
      for (const f of flatAll) {
        if (suttaListIds.includes(f.list.id)) rootHasMember.add(rootOf.get(f.list.id)!);
      }
      const sorted = [...flatAll].sort((a, b) => {
        const aRoot = rootOf.get(a.list.id)!;
        const bRoot = rootOf.get(b.list.id)!;
        if (aRoot === bRoot) return 0;
        return (rootHasMember.has(aRoot) ? 0 : 1) - (rootHasMember.has(bRoot) ? 0 : 1);
      });
      return sorted.map((option) => ({ type: 'list' as const, option }));
    }
    // "Parent / New name" — an explicit typed path to creating a nested list, an alternative to
    // the Shift+Enter/Tab gesture (which has no reliable touch equivalent).
    const slashIdx = q.lastIndexOf('/');
    if (slashIdx !== -1) {
      const parentQuery = q.slice(0, slashIdx).trim().toLowerCase();
      const nameQuery = q.slice(slashIdx + 1).trim();
      if (parentQuery) {
        const parentCandidates = flatAll.filter((f) => f.list.label.toLowerCase().includes(parentQuery));
        const exactParent = flatAll.find((f) => f.list.label.toLowerCase() === parentQuery) ?? parentCandidates[0];
        const listRows: Row[] = parentCandidates.map((option) => ({ type: 'list' as const, option }));
        if (exactParent && nameQuery) {
          return [{ type: 'create-nested', name: nameQuery, parentId: exactParent.list.id, parentLabel: exactParent.list.label }, ...listRows];
        }
        return listRows;
      }
    }
    // Both existing matches AND the option to create a new list with this exact name are always
    // shown together — a new list can legitimately be a substring (or superstring) of an
    // existing one's name (e.g. typing "Te" when "Temp" already exists), so zero-vs-nonzero
    // matches was the wrong signal for whether to offer creating one. createList() itself already
    // dedupes an exact same-label-same-parent create against the existing list.
    const ql = q.toLowerCase();
    const matches = flatAll.filter((f) => f.breadcrumb.toLowerCase().includes(ql));
    const listRows: Row[] = matches.map((option) => ({ type: 'list' as const, option }));
    return [...listRows, { type: 'create-top', name: q }];
  }, [draft, flatAll, suttaListIds, nestingParent]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft, nestingParent]);

  const activeIdx = Math.min(activeIndex, Math.max(0, rows.length - 1));

  async function activateRow(row: Row) {
    if (row.type === 'list') {
      toggleMembership(suttaId, row.option.list.id);
      return;
    }
    try {
      const parentId = row.type === 'create-nested' ? row.parentId : null;
      const list = await createList(row.name, parentId);
      await addToList(suttaId, list);
    } catch {
      // Signed out: createList() already triggered the Google sign-in prompt.
    }
    setDraft('');
    setNestingParent(null);
  }

  function enterNestingMode(list: ListDef) {
    setNestingParent(list);
    setDraft('');
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey)) {
      const row = rows[activeIdx];
      if (row && row.type === 'list' && !nestingParent) {
        e.preventDefault();
        enterNestingMode(row.option.list);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) activateRow(row);
    } else if (e.key === 'Backspace' && draft === '' && nestingParent) {
      e.preventDefault();
      setNestingParent(null);
    } else if (e.key === 'Escape') {
      if (nestingParent) setNestingParent(null);
      else if (draft) setDraft('');
      else onRequestClose?.();
    }
  }

  const rowStyle = (active: boolean) => ({
    borderRadius: 8,
    background: active ? theme.rule : 'transparent',
  });

  return (
    <div>
      {suttaListIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {/* Display only — removal already lives on each row below (unchecking), so these
              aren't clickable, and they use the reader's own surface colours (border + fg text)
              rather than a solid dark fill, matching every other membership chip in the app. */}
          {suttaListIds.map((id) => {
            const breadcrumb = resolveListById(id, flatAll).breadcrumb;
            return (
              <span
                key={id}
                className="inline-flex items-center whitespace-nowrap rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px]"
                style={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
              >
                {breadcrumb}
              </span>
            );
          })}
        </div>
      )}
      {nestingParent && (
        <div className="flex items-center gap-1.5 mb-1.5 font-sans text-[11.5px]" style={{ color: theme.fg, opacity: 0.65 }}>
          <span>
            New list inside <strong>{nestingParent.label}</strong>
          </span>
          <button className="opacity-70 hover:opacity-100" title="Cancel" onClick={() => setNestingParent(null)}>
            ×
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={nestingParent ? 'New sub-list name — return to create' : 'Search or create — "Parent / New" to nest'}
        className="w-full h-11 rounded-[10px] px-3 bg-transparent text-base outline-none"
        style={{ border: `1px solid ${theme.pali}`, color: theme.fg }}
      />
      <div className="mt-1.5">
        {rows.map((row, idx) => {
          const active = idx === activeIdx;
          if (row.type === 'create-top') {
            return (
              <button
                key="create-top"
                className="flex w-full items-center gap-2 px-2 py-[11px] text-left text-[15px]"
                style={rowStyle(active)}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                Create list "{row.name}"
              </button>
            );
          }
          if (row.type === 'create-nested') {
            return (
              <button
                key="create-nested"
                className="flex w-full items-center gap-2 px-2 py-[11px] text-left text-[15px]"
                style={rowStyle(active)}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                Create "{row.name}" inside {row.parentLabel}
              </button>
            );
          }
          const { list, depth, breadcrumb } = row.option;
          const checked = suttaListIds.includes(list.id);
          return (
            <div
              key={list.id}
              className="group flex items-center gap-1"
              style={{ ...rowStyle(active), paddingLeft: 8 + depth * 14 }}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <button className="flex flex-1 min-w-0 items-center gap-2 py-[11px] pr-2 text-left" onClick={() => activateRow(row)}>
                <span
                  className="flex-none w-[16px] h-[16px] rounded-[4px] flex items-center justify-center"
                  style={{ border: `1px solid ${theme.fg}`, background: checked ? theme.fg : 'transparent' }}
                >
                  {checked && <Check size={11} strokeWidth={3} color={theme.bg} />}
                </span>
                <span className="min-w-0 truncate text-[15px]">{breadcrumb}</span>
              </button>
              <button
                className="flex-none w-6 h-6 mr-1 flex items-center justify-center rounded opacity-0 group-hover:opacity-70 hover:!opacity-100 [@media(hover:none)]:opacity-70 transition-opacity"
                title={`New list inside ${list.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  enterNestingMode(list);
                }}
              >
                <Plus size={13} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {rows.length === 0 && nestingParent && (
          <div className="font-sans text-[12.5px] px-2 py-1.5" style={{ opacity: 0.5 }}>
            Type a name to create it inside {nestingParent.label}.
          </div>
        )}
      </div>
    </div>
  );
}
