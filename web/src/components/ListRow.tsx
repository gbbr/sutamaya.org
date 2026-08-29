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
}

export interface ListRowDraftProps {
  creatingParentId: string | null | undefined;
  draft: string;
  onDraftChange: (v: string) => void;
  onDraftKey: (e: KeyboardEvent<HTMLInputElement>) => void;
  draftInputRef: (el: HTMLInputElement | null) => void;
  // Set to this row's id for the network round-trip after its draft input has closed (useListCrud's
  // submitDraft), so the row keeps reserving the input's height until the new list lands.
  submittingParentId: string | null | undefined;
}

// Left indent for a row at the given nesting depth — 22px base plus 16px per level, shared by the
// row and the secondary rows beneath it (delete confirm, options menu, new-list draft) so they stay
// aligned under it. Nesting is unlimited, but the indent stops growing past MAX_INDENT_DEPTH so a
// deep tree can't squeeze row content off a narrow screen; deeper levels are still told apart by
// their expand state.
const MAX_INDENT_DEPTH = 3;
const rowIndent = (depth: number) => 22 + Math.min(depth, MAX_INDENT_DEPTH) * 16;

// One row of the "My lists" tree. A list can nest other lists as children, with button-based
// rename/delete/move controls that work on touch, plus Pointer Events drag-and-drop reordering and
// nesting while "reorder mode" is on.
//
// The drag surface is a dedicated handle on the row's left edge — an icon plus a 30px-wide,
// full-height touch target — rather than the whole row: `touchAction: none` on the row would block
// the list pane's vertical scrolling past it, and would need `userSelect: none` smeared across the
// row to stop text selection. Confining both to the handle keeps the title, count and options
// button scrollable and selectable, matching ListPane's sutta-reorder grip. A press-and-drag
// engages once it clears a small movement threshold; a plain tap reaches the handle's no-op.
// Dropping on the inner half of a group's row nests it as a child, anywhere else resolves to a
// sibling position (see useListTreeDrag's updateDropTarget for the zone math).
//
// Props are grouped by concern (menu/edit/del/draft) rather than flat, which keeps this at ~15
// top-level props instead of 35. The drag props stay flat, passed straight through from TreePane's
// useListTreeDrag(); they are already one cohesive concern.
//
// Wrapped in `memo`, like TreeRow: a TreePane re-render unrelated to a given row shouldn't force
// every list row to re-render. That requires onToggle/onSelect/countFor/onRowPointerDown and the
// prop bundles to stay referentially stable — see TreePane's useCallback/useMemo wrapping.
export const ListRow = memo(function ListRow({
  list,
  depth,
  nodeId,
  childrenOf,
  // The row's right-edge count badge: distinct suttas for a `kind: 'list'` row (`listMemberSets`),
  // or lists and groups nested underneath for a `kind: 'group'` row (`listGroupCounts`), since a
  // group holds no suttas of its own and would always read 0 on the sutta count.
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
  // `deep` is ⌥-click: collapse this group and every group inside it, rather than leaving them
  // flagged open to reappear on the next expand. See TreePane's toggleListExpanded.
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
  const { confirmDeleteId, onDelete, onCancelDelete } = del;
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
  // Either this row is the group being nested into, or it is the group a sibling drop happens to
  // land inside — the same destination either way, so the same tint. Without it, a line under a
  // group's last child and a line under the whole tree look identical while meaning different
  // parents.
  const landsInMe = myEdge === 'inside' || indicator?.insideId === list.id;

  return (
    <div data-component="ListRow">
      <div
        ref={getRowRef(list.id)}
        data-node-id={list.id}
        // The row itself carries the click, not just the label button inside it, so the indentation
        // and the gaps between elements are clickable too. A <div> rather than a <button>, since it
        // wraps interactive children a <button> can't nest. Controls with their own behaviour — the
        // options menu, the drag handle — stopPropagation below.
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
          // 'bottom' recolours and thickens this row's permanent border-bottom rather than layering
          // a second line beside it. resolveDropIndicator has already normalized a 'before' target
          // to the previous row's bottom edge, so this row only handles its own. 'top' is the
          // remaining case needing a drawn-on line (the box-shadow), and occurs only for the very
          // first row in the tree, where there is no row above to recolour.
          borderBottomColor: myEdge === 'bottom' ? 'rgb(var(--accent2))' : undefined,
          borderBottomWidth: myEdge === 'bottom' ? 2 : undefined,
          boxShadow: myEdge === 'top' ? 'inset 0 2px 0 rgb(var(--accent2))' : undefined,
        }}
      >
        {reorderMode && (
          <span
            // The drag surface, named so an end-to-end test can grab it: the gesture is the one
            // part of reordering that only a real browser can exercise (jsdom reports every rect
            // as 0x0), and this span carries no text or role to find it by.
            data-drag-handle
            className="flex-none flex items-center justify-center text-ink-5 -my-[7px] -ml-1.5"
            style={{
              width: 36,
              alignSelf: 'stretch',
              cursor: 'grab',
              // Scoped to the handle rather than the whole row: it blocks the browser's scroll,
              // text-selection and long-press gestures from taking a press here before the
              // threshold-based drag detection engages, and leaves the rest of the row alone.
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            onPointerDown={(e) => onRowPointerDown(e, list.id)}
            // A drag that never clears the pointer session's movement threshold still ends in a
            // plain click on pointerup, stopped here so tapping the handle can't also fire the
            // row's click-to-select above.
            onClick={(e) => e.stopPropagation()}
          >
            {/* The circle is purely a hover cue, sized to match the other round icon buttons
                (e.g. ListPane's add-to-list button) — the actual grab target is the full-height
                span around it, so the circle doesn't need its own touch-target padding. */}
            <span className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-ink/[.08]">
              <GripVertical size={16} strokeWidth={2} />
            </span>
          </span>
        )}
        <button
          className="w-[19px] -ml-1 flex-none flex items-center justify-center text-ink-4 hover:text-ink"
          onClick={(e) => {
            // Intercepts, and stops the row's own click, only when it has an effect — a group's
            // toggle. For a plain list, where the chevron is an empty placeholder, the click passes
            // through to the row's handler.
            if (isGroup) {
              e.stopPropagation();
              onToggle(list.id, e.altKey);
            }
          }}
        >
          {/* A group always shows its chevron — even empty, before it has any children — since
              the chevron is the only thing distinguishing a group row from a list row (no
              separate folder icon; see the comment on ListRow above). A list never shows one:
              it can't hold anything to expand into. */}
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
            // A 38px field is comfortable to type in, but the static label it replaces occupies
            // about 28px — 17px of Newsreader at its line height plus 2px of padding each side — so
            // at its natural height the field would push the row taller the moment a rename starts.
            // The negative margin lets the extra 10px hang outside the line box, into the row's
            // vertical padding, so the field renders full size while contributing the label's height
            // to layout. The label's height is font-metric dependent, so the pairing is tuned by
            // eye: if a rename resizes the row, this is the number to move, so that 38 minus twice
            // it matches.
            //
            // 7px of padding all round, since at 38px tall with 17px type the text already sits
            // about 7px below the top edge and anything tighter horizontally reads as crammed. The
            // negative left margin borrows 6 of the row's 9px gap back, landing the characters
            // within a couple of pixels of the static label while leaving the field's edge clear of
            // the control before it.
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
              // Stops here so the row's onClick doesn't run the identical logic again. Kept as its
              // own handler rather than left to the row, so a keyboard user tabbed to the label can
              // activate it with Enter or Space, which only a real <button> gets for free.
              e.stopPropagation();
              // A group holds no suttas, so clicking one has nothing to show in the list pane; like
              // the corpus tree's chapter rows, it expands and collapses in place.
              if (isGroup) onToggle(list.id, e.altKey);
              else onSelect(String(list.id));
            }}
            // Desktop only, and undefined rather than a handler gated internally: on iOS Safari the
            // mere presence of a reachable `dblclick` listener makes WebKit hold every tap for
            // ~300ms to disambiguate a second one, and React delegates the listener to the app root
            // for the rest of the page load the first time any element uses it. On mobile, rename
            // is reached through the "…" options menu instead.
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
      {confirmDeleteId === list.id ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: rowIndent(depth) + 11 }}>
          {/* Two things keep the buttons on screen in a pane that can be dragged down to 250px
              and indents another 16px per nesting level. `flex-1` gives the prompt a flex basis
              of 0, so it contributes nothing to the line-breaking decision — the buttons stay on
              this line as long as they themselves fit, and a long name shrinks the truncating
              label rather than displacing them. `flex-wrap` covers the remaining case, where even
              the two buttons alone are wider than what's left: they drop to their own line
              instead of being clipped by TreePane's `overflow-hidden`. */}
          <span className="flex-1 min-w-0 flex items-baseline font-sans text-ui-sm text-ink-3">
            <span className="flex-none">Delete&nbsp;"</span>
            <span className="min-w-0 truncate">{list.label}</span>
            <span className="flex-none">"?</span>
          </span>
          <button
            onClick={() => onDelete(list)}
            className="flex-none font-sans text-ui-sm font-semibold px-2 py-[3px] rounded border border-danger-text/40 text-danger-text hover:bg-danger-text/10"
          >
            Delete
          </button>
          <button onClick={onCancelDelete} className="flex-none font-sans text-ui-sm px-2 py-[3px] rounded border border-ink/[.18] text-ink-4 hover:bg-ink/[.08]">
            Cancel
          </button>
        </div>
      ) : (
        menuOpen &&
        !editing && (
          <div className="flex pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: rowIndent(depth) + 11 }}>
            {/* One pill holding borderless icons, rather than a row of individually bordered
                boxes — it reads as a single popped-out toolbar belonging to the row above it,
                and matches the rounded-full vocabulary the rest of the app uses. */}
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
            // submitDraft() has closed the input but createList() hasn't landed, so this row keeps
            // reserving its height and the new list doesn't collapse and then jump when it appears.
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
