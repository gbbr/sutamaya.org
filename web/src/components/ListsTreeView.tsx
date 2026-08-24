import type { RefObject } from 'react';
import type { Highlighter } from 'lucide-react';
import { ArrowUpDown, List, Folder } from 'lucide-react';
import type { ListDef, ListKind } from '../lib/types';
import type { DropIndicator } from '../lib/listTreeDrop';
import { ListRow, type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';
import { SlidingPillToggle } from './SlidingPillToggle';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits';

interface ListsTreeViewProps {
  // Gates the "You have no lists yet" empty state — false until the initial GET /api/data
  // round-trip resolves (UserDataContext's own `ready`), so a signed-in user who actually has
  // lists doesn't see that placeholder flash on screen for the fetch's duration before their
  // real list rows land.
  ready: boolean;
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  reorderMode: boolean;
  setReorderMode: (updater: (m: boolean) => boolean) => void;
  // False when the tree holds fewer than two lists — see TreePane's canReorderLists.
  canReorder: boolean;
  setMenuOpenId: (id: string | null) => void;
  toggleTopLevelDraft: () => void;
  creatingParentId: string | null | undefined;
  setCreatingParentId: (id: string | null | undefined) => void;
  // `RefObject<HTMLInputElement>` rather than `RefObject<HTMLInputElement | null>` — a ref object
  // is already nullable in its own `current`, and only this spelling is what React's `ref` prop
  // accepts below.
  listInput: RefObject<HTMLInputElement>;
  draft: string;
  setDraft: (v: string) => void;
  onDraftKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  draftKind: ListKind;
  setDraftKind: (updater: (k: ListKind) => ListKind) => void;
  submittingParentId: string | null | undefined;
  topLevelLists: ListDef[];
  listChildrenOf: (parentId: string) => ListDef[];
  countFor: (l: ListDef) => number;
  listExpanded: Record<string, boolean>;
  // `deep` is ⌥-click — see ListRow's own note and TreePane's toggleListExpanded.
  onToggleListExpanded: (id: string, deep?: boolean) => void;
  listRowMenu: ListRowMenuProps;
  listRowEdit: ListRowEditProps;
  listRowDelete: ListRowDeleteProps;
  listRowDraft: ListRowDraftProps;
  dragId: string | null;
  indicator: DropIndicator | null;
  onRowPointerDown: (e: React.PointerEvent, id: string) => void;
  getRowRef: (id: string) => (el: HTMLElement | null) => void;
  autoLists: Array<{ list: ListDef; sub: string; Icon: typeof Highlighter }>;
}

// The "My lists" tree (TreePane's other view) — the reorder-mode/new-list header row, the
// top-level new-list/group draft input, the list tree itself (ListRow, recursing into its own
// children), and the read-only "Activity" section (Visited/Highlights/Notes). Its own component
// rather than part of TreePane because it shares almost no JSX with the corpus browse tree it
// alternates with (see CorpusTreeView). All the state driving this view — list CRUD,
// drag-and-drop, expansion — lives in TreePane, via useListCrud/useListTreeDrag/useListTreeIndex;
// this component only renders it.
export function ListsTreeView({
  ready,
  nodeId,
  onSelect,
  reorderMode,
  setReorderMode,
  canReorder,
  setMenuOpenId,
  toggleTopLevelDraft,
  creatingParentId,
  setCreatingParentId,
  listInput,
  draft,
  setDraft,
  onDraftKey,
  draftKind,
  setDraftKind,
  submittingParentId,
  topLevelLists,
  listChildrenOf,
  countFor,
  listExpanded,
  onToggleListExpanded,
  listRowMenu,
  listRowEdit,
  listRowDelete,
  listRowDraft,
  dragId,
  indicator,
  onRowPointerDown,
  getRowRef,
  autoLists,
}: ListsTreeViewProps) {
  return (
    <div data-component="ListsTreeView">
      <div className="flex items-center justify-between pl-[22px] pr-[10px] pt-2 pb-1">
        <span className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3">My lists</span>
        <div className="flex items-center gap-[7px]">
          {canReorder && (
            <button
              aria-label={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
              title={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
              className={`w-[32px] h-[32px] rounded-full flex items-center justify-center ${
                reorderMode ? 'bg-accent2 text-[#FBFAF7]' : 'text-ink-4 hover:bg-ink/[.08] hover:text-ink'
              }`}
              onClick={() => {
                setReorderMode((m) => !m);
                setMenuOpenId(null);
              }}
            >
              <ArrowUpDown size={15} strokeWidth={2} />
            </button>
          )}
          {/* A raw px font-size rather than a `text-ui-*` token: the `+` is an icon glyph sized to
              the 32px circle around it, not UI text, so it doesn't belong to the type scale and
              shouldn't grow when that scale is retuned. */}
          <button
            aria-label="New list or group"
            title="New list or group"
            className="plus w-[32px] h-[32px] rounded-full flex items-center justify-center text-[16px] leading-none text-ink-4 hover:bg-ink/[.08] hover:text-ink"
            onClick={toggleTopLevelDraft}
          >
            +
          </button>
        </div>
      </div>
      {reorderMode && (
        <div className="px-[22px] pb-1.5 font-sans text-ui-xs text-ink-4">Drag a list onto a group to nest it, or to the top/bottom edge of a row to reorder.</div>
      )}
      {creatingParentId === null && (
        <div className="flex items-center gap-[6px] pl-[22px] pr-[10px] pt-1.5 pb-2">
          <input
            ref={listInput}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKey}
            onBlur={() => setCreatingParentId(undefined)}
            placeholder={draftKind === 'group' ? 'Group name — return to create' : 'List name — return to create'}
            maxLength={LIST_NAME_MAX_LENGTH}
            className="font-serif flex-1 min-w-0 h-[36px] border border-accent rounded-lg px-2.5 bg-field text-ui-md outline-none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {/* Icon-only List/Group toggle (no text labels — the input's own placeholder
              already says which one is picked) — a single control spanning both icons, so
              a click anywhere on it flips draftKind, not just on whichever side happens to
              be inactive. onMouseDown preventDefault keeps focus on the input instead of
              shifting it here, so flipping kind mid-type doesn't trigger the input's own
              onBlur (which cancels the whole draft). */}
          <SlidingPillToggle
            active={draftKind === 'list' ? 'left' : 'right'}
            onClick={() => setDraftKind((k) => (k === 'list' ? 'group' : 'list'))}
            onMouseDown={(e) => e.preventDefault()}
            ariaLabel={draftKind === 'list' ? 'Switch to Group' : 'Switch to List'}
            title={draftKind === 'list' ? 'Switch to Group' : 'Switch to List'}
            leftIcon={<List size={18} strokeWidth={2} />}
            rightIcon={<Folder size={18} strokeWidth={2} />}
            leftIconClassName={draftKind === 'list' ? 'text-ink' : 'text-ink-4'}
            rightIconClassName={draftKind === 'group' ? 'text-ink' : 'text-ink-4'}
            slotSize={32}
            thumbClassName="bg-chip border border-ink/[.12] shadow-[0_1px_2px_rgba(27,25,23,.15)] transition-[left] duration-150 ease-out"
          />
        </div>
      )}
      {/* Reserves the draft input row's own height (pt-1.5 + h-36 + pb-2 = 50px) during the
          submitDraft() network round-trip, so the pane doesn't visibly collapse to just the
          header between the input closing (see submitDraft's comment) and the new row landing.
          Scoped to a top-level submission specifically (submittingParentId === null) — a nested
          submission under a group reserves its own row's height in ListRow instead, keyed to
          that group's id, not this one. */}
      {submittingParentId === null && <div className="h-[50px]" />}
      {ready && topLevelLists.length === 0 && creatingParentId !== null && submittingParentId === undefined && (
        <div className="flex flex-col items-center gap-2.5 px-[22px] pt-16 pb-8 text-center">
          <span className="font-sans text-ui-base text-ink-4">You have no lists yet.</span>
          <button
            className="font-sans text-ui-base font-semibold text-accent2 border border-accent2 rounded-lg px-3 py-1.5 hover:bg-accent2/10"
            onClick={toggleTopLevelDraft}
          >
            Create your first list
          </button>
        </div>
      )}
      {topLevelLists.map((l, idx) => (
        <ListRow
          key={l.id}
          list={l}
          depth={0}
          nodeId={nodeId}
          childrenOf={listChildrenOf}
          countFor={countFor}
          listExpanded={listExpanded}
          onToggle={onToggleListExpanded}
          onSelect={onSelect}
          menu={listRowMenu}
          edit={listRowEdit}
          del={listRowDelete}
          draft={listRowDraft}
          siblingIndex={idx}
          siblingCount={topLevelLists.length}
          reorderMode={reorderMode}
          dragId={dragId}
          indicator={indicator}
          onRowPointerDown={onRowPointerDown}
          getRowRef={getRowRef}
        />
      ))}
      {autoLists.length > 0 && (
        <div>
          <div className="px-[22px] pt-[22px] pb-1">
            <span className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3">Activity</span>
          </div>
          {autoLists.map(({ list, sub, Icon }) => (
            <button
              key={list.id}
              data-node-id={list.id}
              className={`row flex items-center gap-[13px] w-full text-left px-[22px] py-[11px] border-b border-ink/[.07] ${
                nodeId === String(list.id) ? 'bg-ink/[.06]' : ''
              }`}
              onClick={() => onSelect(String(list.id))}
            >
              <span className="w-[16px] mr-[5px] flex-none flex items-center justify-center text-ink-4">
                <Icon size={16} strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-ui-md font-medium leading-[1.3]">{list.label}</span>
                <span className="block font-sans text-ui-sm font-medium text-ink-3 mt-[1px]">{sub}</span>
              </span>
              <span className="font-sans text-ui-xs font-medium text-ink-4">{list.items.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
