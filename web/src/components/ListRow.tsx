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
  // Set to this row's own id for the network round-trip after its draft input has already closed
  // (see useListCrud's submitDraft) — keeps this row reserving the input's row height so the new
  // list doesn't visibly collapse-then-jump when it lands.
  submittingParentId: string | null | undefined;
}

// Left indent for a row at the given nesting depth — 22px base plus 16px per level, shared by the
// row itself and the secondary rows (delete confirm, options menu, new-list draft) beneath it so
// they stay visually aligned under the row they belong to. Nesting itself is unlimited, but the
// indent stops growing past MAX_INDENT_DEPTH so a deep tree can't squeeze row content off a narrow
// screen; levels below that are still distinguishable by their expand/collapse state.
const MAX_INDENT_DEPTH = 3;
const rowIndent = (depth: number) => 22 + Math.min(depth, MAX_INDENT_DEPTH) * 16;

// One row of the "My lists" tree — a list can nest other lists as children (folder-like), with
// button-based rename/delete/move controls that always work (touch included), plus Pointer
// Events drag-and-drop reordering/nesting when "reorder mode" (see the toggle by "My lists") is
// on. The drag surface is a dedicated handle on the row's left edge (icon + a 30px-wide, full
// row height touch target), not the whole row: `touchAction: none` on the row itself would also
// block vertical scrolling of the list pane past it, and would need `userSelect: none` smeared
// across the row to stop text selection. Confining both to the handle keeps the rest of the row
// (title, member count, options button) scrollable and selectable as normal, matching ListPane's
// sutta-reorder grip. A press-and-drag on the handle
// engages once it clears a small movement threshold (a plain tap still reaches the handle's
// no-op — nothing else lives there — harmlessly). Dropping on the inner half of a group's row
// nests it as a child, anywhere else resolves to a sibling position (see useListTreeDrag's
// updateDropTarget for the zone math).
//
// Props are grouped by concern (menu/edit/del/draft) rather than flat — keeps this at ~15
// top-level props instead of 35. The drag props (reorderMode/dragId/indicator/
// onRowPointerDown/getRowRef) stay flat, passed straight through from TreePane's own
// useListTreeDrag() (itself built on the shared usePointerDragSession) — they're a single
// cohesive concern already, so bundling them wouldn't reduce the prop count in a meaningful way.
//
// Wrapped in `memo` — same reasoning as TreeRow's own memoization (see its comment): a TreePane
// re-render triggered by something unrelated to a given row (toggling paneView, expanding a
// sibling, navigating) shouldn't force every list row to re-render too. Requires
// onToggle/onSelect/countFor/onRowPointerDown and the menu/edit/del/draft prop bundles to stay
// referentially stable across such renders — see TreePane's own useCallback/useMemo wrapping of
// each.
export const ListRow = memo(function ListRow({
  list,
  depth,
  nodeId,
  childrenOf,
  // The row's right-edge count badge: distinct sutta count for a `kind: 'list'` row (see
  // `listMemberSets`), or the number of lists/groups nested underneath for a `kind: 'group'` row
  // (see `listGroupCounts`) — a group holds no suttas of its own, so its own badge would always
  // read 0 if it used the same sutta-count logic.
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
  onToggle: (id: string) => void;
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

  return (
    <div data-component="ListRow">
      <div
        ref={getRowRef(list.id)}
        data-node-id={list.id}
        // The row itself carries the click (not just the label button inside it) so the
        // indentation and inter-element gaps are clickable too, not just the label text — a
        // plain <div> here (not <button>) since it wraps several of its own interactive
        // children (chevron/label/options), which a <button> can't nest. Controls that need
        // their own distinct behavior (options menu, drag handle) stopPropagation so this
        // doesn't also fire for them — see their own onClick/onPointerDown below.
        className={`row flex items-center gap-[9px] w-full text-left pr-[10px] py-[8px] border-b border-ink/[.07] cursor-pointer ${nodeId === String(list.id) ? 'bg-ink/[.06]' : ''}`}
        onClick={() => {
          if (editing) return;
          if (isGroup) onToggle(list.id);
          else onSelect(String(list.id));
        }}
        style={{
          paddingLeft: rowIndent(depth),
          opacity: dragging ? 0.4 : 1,
          background: myEdge === 'inside' ? 'rgb(var(--accent2) / .16)' : undefined,
          // 'bottom' recolors (and thickens) this row's own permanent border-bottom rather than
          // layering a second line next to it — see resolveDropIndicator for why a 'before'
          // target already gets normalized to the *previous* row's bottom edge before it ever
          // reaches here, so this row only ever needs to handle its own edge. 'top' is the one
          // remaining case that still needs a drawn-on-top line (the box-shadow) — it only occurs
          // for the very first row in the whole tree, where there's no row above to recolor
          // instead, so there's nothing for it to double up with.
          borderBottomColor: myEdge === 'bottom' ? 'rgb(var(--accent2))' : undefined,
          borderBottomWidth: myEdge === 'bottom' ? 2 : undefined,
          boxShadow: myEdge === 'top' ? 'inset 0 2px 0 rgb(var(--accent2))' : undefined,
        }}
      >
        {reorderMode && (
          <span
            className="flex-none flex items-center justify-center text-ink-5 -my-[7px] -ml-1.5"
            style={{
              width: 30,
              alignSelf: 'stretch',
              cursor: 'grab',
              // Scoped to just this handle (not the whole row, see the comment above) — blocks
              // the browser's own scroll/text-selection/long-press-callout gestures from
              // hijacking a press here before our own threshold-based drag detection engages,
              // without affecting touch/scroll/selection anywhere else on the row.
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            onPointerDown={(e) => onRowPointerDown(e, list.id)}
            // A drag that never clears the pointer session's own movement threshold still
            // ends in a plain click on pointerup — stopped here so tapping the handle can't
            // also fire the row's own click-to-select/toggle above.
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={16} strokeWidth={2} />
          </span>
        )}
        <button
          className="w-[19px] -ml-1 flex-none flex items-center justify-center text-ink-4 hover:text-ink"
          onClick={(e) => {
            // Only intercepts (and stops the row's own click from also firing) when it has its
            // own effect, i.e. a group's toggle — for a plain list, where this chevron is just
            // an empty placeholder, the click passes through to the row's handler instead.
            if (isGroup) {
              e.stopPropagation();
              onToggle(list.id);
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
            // A 38px field is the comfortable size to type in, but the static label it replaces
            // occupies about 28px — 17px of Newsreader at its normal line height, plus 2px of
            // padding each side — so at its natural height the field would push the row taller
            // the moment a rename starts. The negative margin lets the extra 10px hang outside the
            // line box, into the row's own vertical padding, so the field renders full size while
            // contributing the label's height to layout. The label's height is font-metric
            // dependent, so this pairing is tuned by eye: if a rename still resizes the row, this
            // is the one number to move, in the direction that makes 38 minus twice it match.
            // 7px of padding all round: at 38px tall with 17px type the text already sits about
            // 7px below the top edge, so anything tighter horizontally reads as a field whose
            // text is crammed against the left wall. The negative left margin then borrows 6 of
            // the row's 9px gap back, which lands the characters within a couple of pixels of
            // where the static label puts them while leaving the field's edge clear of the
            // control before it — taking the exact 8 the inset would need closes that gap
            // entirely and the field sits flush.
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
              // Stops here so this doesn't also fire the identical logic on the row's own
              // onClick via bubbling — kept as its own handler (rather than just relying on the
              // row) so a keyboard user tabbed to the label can still activate it with
              // Enter/Space, which only a real <button> gets for free.
              e.stopPropagation();
              // A group can't hold suttas itself, so clicking one has nothing to show in the
              // list pane — same as the corpus browse tree's own chapter rows (see TreeRow),
              // it just expands/collapses in place instead.
              if (isGroup) onToggle(list.id);
              else onSelect(String(list.id));
            }}
            // Desktop only — undefined (not just gated on click) rather than omitted, since on
            // iOS Safari the mere presence of a `dblclick` listener anywhere reachable makes
            // WebKit hold every tap for ~300ms to disambiguate a possible second tap, and React
            // delegates this listener to the app root the first time any element actually uses
            // it, for the rest of that page load — see the perf investigation this came out of.
            // Rename is still reachable via the "…" options menu's Pencil button on mobile.
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
            className="flex-none w-[20px] h-[20px] flex items-center justify-center rounded text-ink-4 hover:bg-ink/[.08] hover:text-ink"
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
            // submitDraft() has already closed the input (creatingParentId reset) but the
            // createList() network round-trip hasn't landed yet — keep reserving this row's
            // height so the new list doesn't collapse-then-jump when it finally appears.
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
