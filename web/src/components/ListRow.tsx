import { memo } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { DropIndicator } from '../lib/listTreeDrop';
import type { ListDef } from '../lib/types';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits';
import { useLayout } from '../context/LayoutContext';

export interface ListRowMenuProps {
  menuOpenId: string | null;
  onToggleMenu: (id: string) => void;
  onMove: (l: ListDef, dir: -1 | 1) => void;
  onAddChild: (parentId: string) => void;
  onStartEdit: (l: ListDef) => void;
  onArmDelete: (l: ListDef) => void;
}

export interface ListRowEditProps {
  editingId: string | null;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
}

export interface ListRowDeleteProps {
  confirmDeleteId: string | null;
  onDelete: (l: ListDef) => void;
  onCancelDelete: () => void;
  // What deleting the row would take with it, named in the confirmation.
  deleteScopeFor: (l: ListDef) => { lists: number; suttas: number };
}

export interface ListRowDraftProps {
  creatingParentId: string | null | undefined;
  draft: string;
  onDraftChange: (v: string) => void;
  onDraftKey: (e: KeyboardEvent<HTMLInputElement>) => void;
  draftInputRef: (el: HTMLInputElement | null) => void;
  // This row's id while its submitted draft is in flight, so the row keeps reserving the input's
  // height until the new list lands.
  submittingParentId: string | null | undefined;
}

// The depth past which the indent stops growing, so a deep tree can't squeeze row content off a
// narrow screen; those levels are still told apart by their expand state.
const MAX_INDENT_DEPTH = 3;
// A row's left indent, shared by the secondary rows beneath it so they stay aligned under it.
const rowIndent = (depth: number) => 22 + Math.min(depth, MAX_INDENT_DEPTH) * 16;

// One row of the "My lists" tree: the list or group itself, its children, and the secondary rows
// its own controls open — rename, delete confirmation, options menu, new-list draft.
//
// Rename, delete and move are buttons, so they work on touch. Dragging is confined to a handle on
// the left edge rather than the whole row, which would need `touchAction: none` across it and so
// block the pane's own scrolling; the drag itself lives in useListTreeDrag.
//
// Props are bundled by concern (menu/edit/del/draft) rather than passed flat, which keeps this at
// around fifteen top-level props instead of thirty-five. Memoized, so a TreePane render unrelated
// to this row costs nothing here — which requires every callback and bundle to be stable.
export const ListRow = memo(function ListRow({
  list,
  depth,
  nodeId,
  childrenOf,
  // The number for the row's count badge.
  countFor,
  listExpanded,
  onToggle,
  onSelect,
  menu,
  edit,
  del,
  draft: draftProps,
  siblingIndex,
  siblingCount,
  reorderMode,
  dragId,
  indicator,
  onRowPointerDown,
  getRowRef,
}: {
  list: ListDef;
  depth: number;
  nodeId?: string;
  childrenOf: (parentId: string) => ListDef[];
  countFor: (l: ListDef) => number;
  listExpanded: Record<string, boolean>;
  // `deep` is ⌥-click, which collapses every group inside this one too.
  onToggle: (id: string, deep?: boolean) => void;
  onSelect: (id: string) => void;
  menu: ListRowMenuProps;
  edit: ListRowEditProps;
  del: ListRowDeleteProps;
  draft: ListRowDraftProps;
  siblingIndex: number;
  siblingCount: number;
  reorderMode: boolean;
  dragId: string | null;
  indicator: DropIndicator | null;
  onRowPointerDown: (e: React.PointerEvent, id: string) => void;
  getRowRef: (id: string) => (el: HTMLElement | null) => void;
}) {
  const { menuOpenId, onToggleMenu, onMove, onAddChild, onStartEdit, onArmDelete } = menu;
  const { editingId, editDraft, onEditDraftChange, onCommitEdit, onCancelEdit } = edit;
  const { confirmDeleteId, onDelete, onCancelDelete, deleteScopeFor } = del;
  const { creatingParentId, draft, onDraftChange, onDraftKey, draftInputRef, submittingParentId } = draftProps;

  const { mobile } = useLayout();
  const kids = childrenOf(list.id);
  const hasKids = kids.length > 0;
  const isGroup = list.kind === 'group';
  const open = !!listExpanded[list.id];
  const editing = editingId === list.id;
  const menuOpen = menuOpenId === list.id;
  const dragging = dragId === list.id;
  const myEdge = indicator?.id === list.id ? indicator.edge : null;
  // True when the drop lands in this group, whether by nesting into it or as a sibling of its
  // children — the same destination, so the same tint.
  const landsInMe = myEdge === 'inside' || indicator?.insideId === list.id;

  // What deleting this row would take with it, for a second line under the prompt; null for an
  // empty row, which keeps the ordinary case on one line.
  const confirming = confirmDeleteId === list.id;
  const deleteScope = confirming ? deleteScopeFor(list) : null;
  const deleteScopeText =
    deleteScope &&
    [
      deleteScope.lists ? `${deleteScope.lists} ${deleteScope.lists === 1 ? 'list' : 'lists'}` : null,
      deleteScope.suttas ? `${deleteScope.suttas} ${deleteScope.suttas === 1 ? 'sutta' : 'suttas'}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const actions = (
    <>
      <button
        onClick={() => onDelete(list)}
        className="flex-none font-sans text-ui-sm font-semibold px-2 py-[3px] rounded border border-danger-text/40 text-danger-text hover:bg-danger-text/10"
      >
        Delete
      </button>
      <button onClick={onCancelDelete} className="flex-none font-sans text-ui-sm px-2 py-[3px] rounded border border-ink/[.18] text-ink-4 hover:bg-ink/[.08]">
        Cancel
      </button>
    </>
  );

  return (
    <div data-component="ListRow">
      <div
        ref={getRowRef(list.id)}
        data-node-id={list.id}
        // The whole row carries the click, indentation and gaps included, so a <div> rather than a
        // <button>, which can't nest the interactive children. The controls with behaviour of
        // their own stopPropagation below.
        className={`row flex items-center gap-[9px] w-full text-left pr-[10px] py-[10px] border-b border-ink/[.07] cursor-pointer ${nodeId === String(list.id) ? 'bg-ink/[.06]' : ''}`}
        onClick={(e) => {
          if (editing) return;
          if (isGroup) onToggle(list.id, e.altKey);
          else onSelect(String(list.id));
        }}
        style={{
          paddingLeft: rowIndent(depth),
          opacity: dragging ? 0.4 : 1,
          background: landsInMe ? 'rgb(var(--accent2) / .16)' : undefined,
          // The drop line: 'bottom' recolours this row's own permanent border rather than layering
          // a second line beside it; 'top' draws one, which only the tree's first row needs.
          borderBottomColor: myEdge === 'bottom' ? 'rgb(var(--accent2))' : undefined,
          borderBottomWidth: myEdge === 'bottom' ? 2 : undefined,
          boxShadow: myEdge === 'top' ? 'inset 0 2px 0 rgb(var(--accent2))' : undefined,
        }}
      >
        {reorderMode && (
          <span
            // Named so an end-to-end test can grab it: the gesture needs a real browser, jsdom
            // reporting every rect as 0x0, and this span carries no text or role to find it by.
            data-drag-handle
            className="flex-none flex items-center justify-center text-ink-5 -my-[7px] -ml-1.5"
            style={{
              width: 36,
              alignSelf: 'stretch',
              cursor: 'grab',
              // Scoped to the handle, so the browser's scroll, selection and long-press gestures
              // can't take a press here, while the rest of the row keeps all three.
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            onPointerDown={(e) => onRowPointerDown(e, list.id)}
            // A drag that never clears the movement threshold still ends in a click, stopped here
            // so tapping the handle can't select the row.
            onClick={(e) => e.stopPropagation()}
          >
            {/* A hover cue only — the grab target is the full-height span around it, so this
                needs no touch-target padding of its own. */}
            <span className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-ink/[.08]">
              <GripVertical size={16} strokeWidth={2} />
            </span>
          </span>
        )}
        <button
          className="w-[19px] -ml-1 flex-none flex items-center justify-center text-ink-4 hover:text-ink"
          onClick={(e) => {
            // Stops the row's own click only where this one does something; on a list, where the
            // chevron is an empty placeholder, it passes through.
            if (isGroup) {
              e.stopPropagation();
              onToggle(list.id, e.altKey);
            }
          }}
        >
          {/* A group always shows its chevron, empty or not, that being the only thing marking it
              as a group; a list never does, having nothing to expand into. */}
          {isGroup ? open ? <ChevronDown size={17} strokeWidth={2} /> : <ChevronRight size={17} strokeWidth={2} /> : null}
        </button>
        {editing ? (
          <input
            autoFocus
            value={editDraft}
            onChange={(e) => onEditDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit();
              } else if (e.key === 'Escape') onCancelEdit();
            }}
            onBlur={onCommitEdit}
            maxLength={LIST_NAME_MAX_LENGTH}
            // The rename field is 38px tall but contributes the ~28px static label's height to
            // layout, the negative vertical margin hanging the difference in the row's own padding
            // — so a rename doesn't resize the row. The label's height is font-metric dependent,
            // so if it ever does, this is the number to move: 38 minus twice it. The negative left
            // margin borrows back most of the row's gap, landing the characters where the label's
            // were.
            className="font-serif flex-1 min-w-0 h-[38px] -my-[5px] -ml-[6px] border border-accent rounded px-[7px] bg-field text-ui-md outline-none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        ) : (
          <button
            className="font-serif flex-1 min-w-0 text-left text-ui-md font-medium truncate py-[2px]"
            onClick={(e) => {
              // The label repeats the row's own behaviour rather than deferring to it, so a
              // keyboard user tabbed here can activate it with Enter or Space.
              e.stopPropagation();
              // A group holds no suttas, so it expands in place as a corpus chapter row does.
              if (isGroup) onToggle(list.id, e.altKey);
              else onSelect(String(list.id));
            }}
            // Undefined on mobile rather than gated inside the handler: the mere presence of a
            // `dblclick` listener makes WebKit hold every tap ~300ms to disambiguate, and React
            // delegates it to the app root for the rest of the page load. Rename is in the "…"
            // menu there.
            onDoubleClick={mobile ? undefined : () => onStartEdit(list)}
          >
            {list.label}
          </button>
        )}
        {!editing && (
          <span className="flex-none font-sans text-ui-xs font-medium text-ink-4">{countFor(list)}</span>
        )}
        {!editing && (
          <button
            className="relative flex-none w-[20px] h-[20px] flex items-center justify-center text-ink-4 hover:text-ink after:content-[''] after:absolute after:-inset-y-2.5"
            aria-label="List options"
            title="List options"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu(list.id);
            }}
          >
            <MoreHorizontal size={17} strokeWidth={2} />
          </button>
        )}
      </div>
      {confirming ? (
        <div data-component="DeleteConfirm" className="pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: rowIndent(depth) + 11 }}>
          {/* The delete confirmation. `flex-1` gives the name a basis of 0, so it truncates rather
              than pushing the buttons off a pane narrowed to 250px, and `flex-wrap` drops them to
              their own line where even they don't fit. The buttons ride whichever line is last, so
              an empty row confirms on one. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex-1 min-w-0 flex items-baseline font-sans text-ui-sm text-ink-3">
              <span className="flex-none">Delete&nbsp;"</span>
              <span className="min-w-0 truncate">{list.label}</span>
              <span className="flex-none">"?</span>
            </span>
            {!deleteScopeText && actions}
          </div>
          {deleteScopeText && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-[3px]">
              <span className="flex-1 min-w-0 truncate font-sans text-ui-sm text-ink-3">{deleteScopeText}</span>
              {actions}
            </div>
          )}
        </div>
      ) : (
        menuOpen &&
        !editing && (
          <div className="flex pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: rowIndent(depth) + 11 }}>
            {/* The options menu, as one pill of borderless icons belonging to the row above it. */}
            <div className="flex items-center gap-[2px] rounded-full bg-ink/[.06] p-[3px]">
              <button
                aria-label="Move up"
                title="Move up"
                disabled={siblingIndex === 0}
                onClick={() => onMove(list, -1)}
                className="w-[30px] h-[28px] flex items-center justify-center rounded-full text-ink-4 hover:bg-ink/[.10] hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
              >
                <ChevronUp size={16} strokeWidth={2} />
              </button>
              <button
                aria-label="Move down"
                title="Move down"
                disabled={siblingIndex === siblingCount - 1}
                onClick={() => onMove(list, 1)}
                className="w-[30px] h-[28px] flex items-center justify-center rounded-full text-ink-4 hover:bg-ink/[.10] hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
              >
                <ChevronDown size={16} strokeWidth={2} />
              </button>
              {list.kind === 'group' && (
                <button
                  aria-label="New list in this group"
                  title="New list in this group"
                  onClick={() => onAddChild(list.id)}
                  className="w-[30px] h-[28px] flex items-center justify-center rounded-full text-ink-4 hover:bg-ink/[.10] hover:text-ink"
                >
                  <Plus size={17} strokeWidth={2} />
                </button>
              )}
              <button
                aria-label="Rename"
                title="Rename"
                onClick={() => onStartEdit(list)}
                className="w-[30px] h-[28px] flex items-center justify-center rounded-full text-ink-4 hover:bg-ink/[.10] hover:text-ink"
              >
                <Pencil size={15} strokeWidth={2} />
              </button>
              <button
                aria-label="Delete"
                title="Delete"
                onClick={() => onArmDelete(list)}
                className="w-[30px] h-[28px] flex items-center justify-center rounded-full text-ink-4 hover:bg-danger-text/[.12] hover:text-danger-text"
              >
                <Trash2 size={15} strokeWidth={2} />
              </button>
            </div>
          </div>
        )
      )}
      {(creatingParentId === list.id || submittingParentId === list.id) && (
        <div className="pr-[18px] pt-1 pb-2" style={{ paddingLeft: rowIndent(depth + 1) }}>
          {creatingParentId === list.id ? (
            <input
              ref={draftInputRef}
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onDraftKey}
              onBlur={() => onDraftKey({ key: 'Escape' } as KeyboardEvent<HTMLInputElement>)}
              placeholder="List name — return to create"
              maxLength={LIST_NAME_MAX_LENGTH}
              className="font-serif w-full h-[32px] border border-accent rounded-lg px-2.5 bg-field text-ui-md outline-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          ) : (
            // Holds the closed draft input's height while the create is in flight, so the row
            // doesn't collapse and then jump when the new list appears.
            <div className="h-[32px]" />
          )}
        </div>
      )}
      {hasKids &&
        open &&
        kids.map((k, idx) => (
          <ListRow
            key={k.id}
            list={k}
            depth={depth + 1}
            nodeId={nodeId}
            childrenOf={childrenOf}
            countFor={countFor}
            listExpanded={listExpanded}
            onToggle={onToggle}
            onSelect={onSelect}
            menu={menu}
            edit={edit}
            del={del}
            draft={draftProps}
            siblingIndex={idx}
            siblingCount={kids.length}
            reorderMode={reorderMode}
            dragId={dragId}
            indicator={indicator}
            onRowPointerDown={onRowPointerDown}
            getRowRef={getRowRef}
          />
        ))}
    </div>
  );
});
