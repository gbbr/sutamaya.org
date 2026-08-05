import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Folder, Plus } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
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
  | { type: 'create-top-list'; name: string }
  | { type: 'create-top-group'; name: string }
  | { type: 'create-nested-list'; name: string; parentId: string; parentLabel: string }
  | { type: 'create-nested-group'; name: string; parentId: string; parentLabel: string };

// A single-input, multi-select "add to lists" widget: type to filter, Enter toggles membership
// on the highlighted row without closing, Shift+Enter/Tab on a highlighted *group* row nests a
// new list/group inside it, and "Group / New name" typed directly does the same without needing
// the shortcut. Only a group can contain anything (see ListDef.kind in lib/types.ts), so a group
// row never shows a membership checkmark (it can't hold this sutta itself) and a plain list row
// never shows the nesting "+" (it can't hold anything either) — and any typed name that isn't an
// exact existing match offers creating either a list or a group with it, since which one the
// user wants isn't inferrable from the text alone. Shared by the reader's Lists tab and
// (eventually) the preview pane's "In lists" editor, so both get the same fast add-to-multiple-
// lists flow instead of two hand-rolled pickers.
export function ListMembershipPicker({ suttaId, theme, autoFocus, onRequestClose }: ListMembershipPickerProps) {
  const { user, promptGoogleSignIn } = useAuth();
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
      return name
        ? [
            { type: 'create-nested-list', name, parentId: nestingParent.id, parentLabel: nestingParent.label },
            { type: 'create-nested-group', name, parentId: nestingParent.id, parentLabel: nestingParent.label },
          ]
        : [];
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
    // "Group / New name" — an explicit typed path to creating something nested, an alternative
    // to the Shift+Enter/Tab gesture (which has no reliable touch equivalent). Only a group can
    // be nested into, so the exact-match lookup is scoped to group rows — an exact match against
    // a plain list's name still shows up in `listRows` below (for toggling its membership), it
    // just doesn't offer a "create nested under it" row.
    const slashIdx = q.lastIndexOf('/');
    if (slashIdx !== -1) {
      const parentQuery = q.slice(0, slashIdx).trim().toLowerCase();
      const nameQuery = q.slice(slashIdx + 1).trim();
      if (parentQuery) {
        const parentCandidates = flatAll.filter((f) => f.list.label.toLowerCase().includes(parentQuery));
        const exactParent = flatAll.find((f) => f.list.kind === 'group' && f.list.label.toLowerCase() === parentQuery);
        const listRows: Row[] = parentCandidates.map((option) => ({ type: 'list' as const, option }));
        if (exactParent && nameQuery) {
          return [
            { type: 'create-nested-list', name: nameQuery, parentId: exactParent.list.id, parentLabel: exactParent.list.label },
            { type: 'create-nested-group', name: nameQuery, parentId: exactParent.list.id, parentLabel: exactParent.list.label },
            ...listRows,
          ];
        }
        return listRows;
      }
    }
    // Both existing matches AND the option to create a new list/group with this exact name are
    // always shown together — a new one can legitimately be a substring (or superstring) of an
    // existing name (e.g. typing "Te" when "Temp" already exists), so zero-vs-nonzero matches was
    // the wrong signal for whether to offer creating one. createList() itself already dedupes an
    // exact same-label-same-parent-same-kind create against an existing list/group.
    const ql = q.toLowerCase();
    const matches = flatAll.filter((f) => f.breadcrumb.toLowerCase().includes(ql));
    const listRows: Row[] = matches.map((option) => ({ type: 'list' as const, option }));
    return [...listRows, { type: 'create-top-list', name: q }, { type: 'create-top-group', name: q }];
  }, [draft, flatAll, suttaListIds, nestingParent]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft, nestingParent]);

  const activeIdx = Math.min(activeIndex, Math.max(0, rows.length - 1));

  async function activateRow(row: Row) {
    if (row.type === 'list') {
      // A group can't hold this sutta itself — the only useful click on a group row is drilling
      // into it to create something inside, same as its own "+" button.
      if (row.option.list.kind === 'group') {
        enterNestingMode(row.option.list);
        return;
      }
      toggleMembership(suttaId, row.option.list.id);
      return;
    }
    const isGroup = row.type === 'create-top-group' || row.type === 'create-nested-group';
    const parentId = row.type === 'create-nested-list' || row.type === 'create-nested-group' ? row.parentId : null;
    try {
      const list = await createList(row.name, parentId, isGroup ? 'group' : 'list');
      // A freshly created group can't hold the sutta — nothing to add it to.
      if (!isGroup) await addToList(suttaId, list);
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
      if (row && row.type === 'list' && row.option.list.kind === 'group' && !nestingParent) {
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
      // Stops here (doesn't bubble to the reader's own window-level Escape handler — see
      // ReaderPage) so a first Escape clearing nesting/draft doesn't also skip straight to
      // closing the whole panel in the same keypress.
      e.stopPropagation();
      if (nestingParent) setNestingParent(null);
      else if (draft) setDraft('');
      else onRequestClose?.();
    }
  }

  // Signed out, `lists`/`membership` are always empty (see UserDataContext) — rather than show a
  // search box with nothing to search and a "Create list" row that silently just re-prompts sign
  // in the moment it's used, show the prompt directly.
  if (!user) {
    return (
      <div data-component="ListMembershipPicker" className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="font-sans text-[13.5px]" style={{ color: theme.fg, opacity: 0.6 }}>
          Sign in to add this sutta to a list.
        </p>
        <button
          className="font-sans text-[13px] font-semibold px-4 py-[9px] rounded-full"
          style={{ background: theme.fg, color: theme.bg }}
          onClick={promptGoogleSignIn}
        >
          Sign in
        </button>
      </div>
    );
  }

  const rowStyle = (active: boolean) => ({
    borderRadius: 8,
    background: active ? theme.rule : 'transparent',
  });

  return (
    <div data-component="ListMembershipPicker">
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
            New list or group inside <strong>{nestingParent.label}</strong>
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
        placeholder={nestingParent ? 'Name — return to create' : 'Search or create — "Group / New" to nest'}
        className="w-full h-11 rounded-[10px] px-3 bg-transparent text-base outline-none"
        style={{ border: `1px solid ${theme.pali}`, color: theme.fg }}
      />
      <div className="mt-1.5">
        {rows.map((row, idx) => {
          const active = idx === activeIdx;
          if (row.type === 'create-top-list' || row.type === 'create-nested-list') {
            const label = row.type === 'create-nested-list' ? `Create list "${row.name}" inside ${row.parentLabel}` : `Create list "${row.name}"`;
            return (
              <button
                key={row.type}
                className="flex w-full items-center gap-2 px-2 py-[11px] text-left text-[15px]"
                style={rowStyle(active)}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                {label}
              </button>
            );
          }
          if (row.type === 'create-top-group' || row.type === 'create-nested-group') {
            const label = row.type === 'create-nested-group' ? `Create group "${row.name}" inside ${row.parentLabel}` : `Create group "${row.name}"`;
            return (
              <button
                key={row.type}
                className="flex w-full items-center gap-2 px-2 py-[11px] text-left text-[15px]"
                style={rowStyle(active)}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activateRow(row)}
              >
                <Folder size={13} strokeWidth={2} className="flex-none opacity-60" />
                {label}
              </button>
            );
          }
          const { list, depth, breadcrumb } = row.option;
          const isGroup = list.kind === 'group';
          const checked = !isGroup && suttaListIds.includes(list.id);
          return (
            <div
              key={list.id}
              className="group flex items-center gap-1"
              style={{ ...rowStyle(active), paddingLeft: 8 + depth * 14 }}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <button className="flex flex-1 min-w-0 items-center gap-2 py-[11px] pr-2 text-left" onClick={() => activateRow(row)}>
                {isGroup ? (
                  // Rows here are always flattened/already "expanded" (see flattenListTree) —
                  // this chevron is a static, non-interactive indicator that the row is a group
                  // (matching the tree pane's own groups, which show a chevron instead of a
                  // folder icon), not an actual expand/collapse toggle.
                  <ChevronDown size={14} strokeWidth={2} className="flex-none opacity-50" style={{ color: theme.fg }} />
                ) : (
                  <span
                    className="flex-none w-[16px] h-[16px] rounded-[4px] flex items-center justify-center"
                    style={{ border: `1px solid ${theme.fg}`, background: checked ? theme.fg : 'transparent' }}
                  >
                    {checked && <Check size={11} strokeWidth={3} color={theme.bg} />}
                  </span>
                )}
                <span className="min-w-0 truncate text-[15px]">{breadcrumb}</span>
              </button>
              {isGroup && (
                <button
                  className="flex-none w-6 h-6 mr-1 flex items-center justify-center rounded opacity-0 group-hover:opacity-70 hover:!opacity-100 [@media(hover:none)]:opacity-70 transition-opacity"
                  title={`New list or group inside ${list.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    enterNestingMode(list);
                  }}
                >
                  <Plus size={13} strokeWidth={2} />
                </button>
              )}
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
