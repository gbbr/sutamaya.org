import type { RefObject } from 'react';
import type { Highlighter } from 'lucide-react';
import { ArrowUpDown, List, Folder } from 'lucide-react';
import type { ListDef, ListKind } from '../lib/types';
import type { DropIndicator } from '../lib/listTreeDrop';
import { ListRow, type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';
import { SlidingPillToggle } from './SlidingPillToggle';

interface ListsTreeViewProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  reorderMode: boolean;
  setReorderMode: (updater: (m: boolean) => boolean) => void;
  setMenuOpenId: (id: string | null) => void;
  toggleTopLevelDraft: () => void;
  creatingParentId: string | null | undefined;
  setCreatingParentId: (id: string | null | undefined) => void;
  listInput: RefObject<HTMLInputElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onDraftKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  draftKind: ListKind;
  setDraftKind: (updater: (k: ListKind) => ListKind) => void;
  topLevelLists: ListDef[];
  listChildrenOf: (parentId: string) => ListDef[];
  countFor: (l: ListDef) => number;
  listExpanded: Record<string, boolean>;
  onToggleListExpanded: (id: string) => void;
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
// children), and the read-only "Automatic" section (Recent/Highlights/Notes). Split out of
// TreePane, which otherwise mixed this with the unrelated corpus browse tree render (see
// CorpusTreeView) in one component; the two share almost no JSX. All the state driving this view
// (list CRUD, drag-and-drop, expansion) still lives in TreePane itself, via useListCrud/
// useListTreeDrag/useListTreeIndex — this component only renders it.
export function ListsTreeView({
  nodeId,
  onSelect,
  reorderMode,
  setReorderMode,
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
      <div className="flex items-center justify-between pl-[18px] pr-[10px] pt-2 pb-1">
        <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">My lists</span>
        <div className="flex items-center gap-[7px]">
          <button
            aria-label={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
            title={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
            className={`w-[22px] h-[22px] border rounded-md flex items-center justify-center ${
              reorderMode ? 'border-accent2 bg-accent2 text-[#FBFAF7]' : 'border-ink/[.20] bg-transparent text-ink/50 hover:bg-ink/[.06]'
            }`}
            onClick={() => {
              setReorderMode((m) => !m);
              setMenuOpenId(null);
            }}
          >
            <ArrowUpDown size={12} strokeWidth={2} />
          </button>
          <button
            aria-label="New list or group"
            title="New list or group"
            className="plus w-[22px] h-[22px] border border-ink/[.20] rounded-md flex items-center justify-center text-[15px] leading-none text-ink/50 hover:bg-ink/[.06]"
            onClick={toggleTopLevelDraft}
          >
            +
          </button>
        </div>
      </div>
      {reorderMode && (
        <div className="px-[18px] pb-1.5 font-sans text-[11.5px] text-ink/45">Drag a list onto a group to nest it, or to the top/bottom edge of a row to reorder.</div>
      )}
      {creatingParentId === null && (
        <div className="flex items-center gap-[6px] pl-[18px] pr-[10px] pt-1.5 pb-2">
          <input
            ref={listInput}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKey}
            onBlur={() => setCreatingParentId(undefined)}
            placeholder={draftKind === 'group' ? 'Group name — return to create' : 'List name — return to create'}
            className="font-serif flex-1 min-w-0 h-[34px] border border-accent rounded-lg px-2.5 bg-field text-[14.5px] outline-none"
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
            leftIcon={<List size={13} strokeWidth={2} />}
            rightIcon={<Folder size={13} strokeWidth={2} />}
            leftIconClassName={draftKind === 'list' ? 'text-ink' : 'text-ink/50'}
            rightIconClassName={draftKind === 'group' ? 'text-ink' : 'text-ink/50'}
            slotSize={26}
            thumbClassName="bg-chip border border-ink/[.12] shadow-[0_1px_2px_rgba(27,25,23,.15)] transition-[left] duration-150 ease-out"
          />
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
          <div className="px-[18px] pt-[22px] pb-1">
            <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">Automatic</span>
          </div>
          {autoLists.map(({ list, sub, Icon }) => (
            <button
              key={list.id}
              data-node-id={list.id}
              className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${
                nodeId === String(list.id) ? 'bg-ink/[.06]' : ''
              }`}
              onClick={() => onSelect(String(list.id))}
            >
              <span className="w-[11px] flex-none flex items-center justify-center text-ink/40">
                <Icon size={13} strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[16px] font-semibold leading-[1.3]">{list.label}</span>
                <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{sub}</span>
              </span>
              <span className="font-sans text-[11.5px] font-medium text-ink/50">{list.items.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
