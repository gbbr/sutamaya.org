import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import type { SegmentFile } from '../lib/corpus';
import { groupHighlights, highlightGroupText } from '../lib/highlights';
import type { ListDef, ReaderFace, ReaderTheme, ThemeColors } from '../lib/types';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: 'highlights' | 'lists' | 'text';
  segments: SegmentFile[] | null;
  onClose: () => void;
  onJumpToHighlight: (segIndex: number) => void;
}

const THEME_SWATCHES: Array<{ id: ReaderTheme; label: string; bg: string; fg: string }> = [
  { id: 'light', label: 'Light', bg: '#FBFAF7', fg: '#1B1917' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E' },
  { id: 'dark', label: 'Dark', bg: '#2A241E', fg: '#EDE6D9' },
];
const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
];

export function ReaderMenuPanel({ suttaId, mobile, theme, initialTab, segments, onClose, onJumpToHighlight }: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const {
    notes,
    submitNote,
    highlights,
    removeHighlights,
    lists,
    membership,
    toggleMembership,
    addToList,
    createList,
    renameList,
    removeList,
    reorderLists,
  } = useUserData();
  const { theme: currentTheme, setTheme, fs, setFs, lh, setLh, face, setFace, allPali, toggleAllPali } = useReaderPrefs();
  const [draft, setDraft] = useState('');
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [menuOpenListId, setMenuOpenListId] = useState<string | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteListId, setConfirmDeleteListId] = useState<string | null>(null);
  const listInput = useRef<HTMLInputElement>(null);

  const suttaHighlights = highlights[suttaId] || [];
  const suttaLists = membership[suttaId] || [];
  const highlightGroups = useMemo(() => groupHighlights(suttaHighlights, segments), [suttaHighlights, segments]);
  // Labels of the two auto-managed lists (see server/src/routes/data.js's buildUserData), used
  // below to recognize them among `suttaLists`, which — unlike `lists` — only carries labels,
  // not the ListDef.auto flag.
  const autoLabels = useMemo(() => new Set(lists.filter((l) => l.auto).map((l) => l.label)), [lists]);
  // The picker below the input: every non-auto list, narrowed to those matching what's typed so
  // far — Enter selects whichever one is highlighted (even mid-typed), Up/Down moves the
  // highlight, and an empty result falls through to creating `draft` as a new list instead.
  const filteredLists = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const pool = lists.filter((l) => !l.auto);
    return q ? pool.filter((l) => l.label.toLowerCase().includes(q)) : pool;
  }, [lists, draft]);
  const activeIndex = Math.min(activeFilterIndex, filteredLists.length - 1);

  const panelStyle = mobile
    ? {
        position: 'absolute' as const,
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '74%',
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        borderTop: `2px solid ${theme.fg}`,
        borderRadius: '16px 16px 0 0',
        padding: '12px 20px 22px',
      }
    : {
        position: 'absolute' as const,
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        borderLeft: `2px solid ${theme.fg}`,
        padding: '18px 20px 22px',
      };

  async function submitDraft() {
    const name = draft.trim();
    if (!name) return;
    try {
      const list = await createList(name);
      setDraft('');
      setActiveFilterIndex(0);
      await addToList(suttaId, list);
    } catch {
      // Signed out: createList() already triggered the Google sign-in prompt.
    }
  }
  function selectList(label: string) {
    if (!suttaLists.includes(label)) toggleMembership(suttaId, label);
    setDraft('');
    setActiveFilterIndex(0);
  }
  function onDraftChange(v: string) {
    setDraft(v);
    setActiveFilterIndex(0);
  }
  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveFilterIndex((i) => Math.min(filteredLists.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveFilterIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const match = filteredLists[activeIndex];
      if (match) selectList(match.label);
      else submitDraft();
    }
  }

  // Editing (rename/delete/reorder) mirrors TreePane's ListRow, scoped to the flat top-level
  // list — the reader's picker isn't a tree browser, so there's no sub-list nesting here.
  function startEditList(l: ListDef) {
    setMenuOpenListId(null);
    setEditingListId(l.id);
    setEditDraft(l.label);
  }
  function commitEditList() {
    const id = editingListId;
    const text = editDraft.trim();
    setEditingListId(null);
    if (!id) return;
    if (text) renameList(id, text);
  }
  function cancelEditList() {
    setEditingListId(null);
  }
  function armDeleteList(l: ListDef) {
    setMenuOpenListId(null);
    setConfirmDeleteListId(l.id);
  }
  function deleteList(l: ListDef) {
    setConfirmDeleteListId(null);
    removeList(l.id, l.label);
  }
  // Only meaningful against the full, unfiltered order — disabled while a search narrows
  // `filteredLists`, since the visible subset's order doesn't reflect true sibling positions.
  function moveList(l: ListDef, dir: -1 | 1) {
    const idx = filteredLists.findIndex((s) => s.id === l.id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= filteredLists.length) return;
    const order = filteredLists.map((s) => s.id);
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    reorderLists(null, order);
  }

  const tabBtn = (id: 'highlights' | 'lists' | 'text', label: string) => (
    <button
      key={id}
      className="flex-1 text-center py-[9px] rounded-field font-sans text-[13.5px] border"
      style={{
        borderColor: theme.rule,
        background: tab === id ? theme.fg : 'transparent',
        color: tab === id ? theme.bg : theme.fg,
      }}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  const ctlRowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${theme.rule}` };
  const pill = (on: boolean) => ({
    borderRadius: 14,
    padding: '5px 13px',
    fontSize: 12.5,
    border: `1px solid ${theme.rule}`,
    background: on ? theme.fg : 'transparent',
    color: on ? theme.bg : theme.fg,
  });

  return (
    <>
      <div className="absolute inset-0" style={{ background: mobile ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.12)' }} onClick={onClose} />
      <div style={panelStyle} className={mobile ? 'animate-sheetUp' : 'animate-fadeIn'}>
        {mobile && <div className="w-11 h-1 rounded-full mx-auto mb-3.5" style={{ background: theme.rule }} />}
        <div className="flex gap-2 mb-4">
          {tabBtn('highlights', 'Highlights')}
          {tabBtn('lists', 'Lists')}
          {tabBtn('text', 'Text')}
        </div>

        {tab === 'highlights' && (
          <div className="sc flex-1 min-h-0">
            <div className="rounded-field mb-3.5 p-[11px_13px]" style={{ border: `1px solid ${theme.rule}`, padding: '11px 13px' }}>
              <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-[5px]">Sutta note</div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                placeholder="Add a note — return to save, shift+return for a new line"
                textareaClassName="w-full bg-transparent text-[16px] resize-none outline-none font-serif"
                textareaStyle={{ border: 0, color: theme.fg }}
                saveButtonClassName="mt-1.5 font-sans text-[11.5px] font-semibold px-2 py-[3px] rounded"
                saveButtonStyle={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
              />
            </div>
            {highlightGroups.map((g) => (
              <button
                key={g.key}
                className="flex w-full gap-2.5 items-start py-2.5 text-left"
                style={{ borderBottom: `1px solid ${theme.rule}` }}
                onClick={() => onJumpToHighlight(g.i)}
              >
                <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: g.c }} />
                <span className="flex-1 text-sm leading-[1.45]">{highlightGroupText(g, segments).slice(0, 92) || `Segment ${g.i + 1}`}</span>
                <span
                  className="flex items-center gap-1 font-sans text-[11.5px] opacity-45"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHighlights(
                      suttaId,
                      g.items.map((h) => h.id)
                    );
                  }}
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                  Remove
                </span>
              </button>
            ))}
            {highlightGroups.length === 0 && (
              <div className="font-sans text-[12.5px] opacity-40 py-1.5">Select text in the reading, then pick a colour.</div>
            )}
          </div>
        )}

        {tab === 'lists' && (
          <div className="sc flex-1 min-h-0">
            <input
              ref={listInput}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onDraftKey}
              placeholder="List name — return to create & add"
              className="w-full h-11 rounded-[10px] px-3 bg-transparent text-base outline-none"
              style={{ border: `1px solid #8A6A3B`, color: theme.fg }}
            />
            <div className="flex flex-wrap gap-1.5 my-3.5">
              {suttaLists.map((label) =>
                autoLabels.has(label) ? (
                  <span
                    key={label}
                    className="inline-flex items-center whitespace-nowrap rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px]"
                    style={{ border: `1px solid ${theme.rule}`, color: theme.fg, opacity: 0.6 }}
                  >
                    {label}
                  </span>
                ) : (
                  <button
                    key={label}
                    className="inline-flex items-center whitespace-nowrap rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px]"
                    style={{ background: theme.fg, color: theme.bg }}
                    onClick={() => toggleMembership(suttaId, label)}
                  >
                    {label} ×
                  </button>
                )
              )}
            </div>
            <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-1">
              {filteredLists.length === 0 && draft.trim() ? 'No matches — return to create' : 'Or pick from your lists'}
            </div>
            {filteredLists.map((l, idx) => (
              <div key={l.id}>
                <div
                  className="flex items-center gap-2 w-full py-[11px] px-2 rounded-[8px]"
                  style={{ borderBottom: `1px solid ${theme.rule}`, background: idx === activeIndex ? theme.rule : 'transparent' }}
                  onMouseEnter={() => setActiveFilterIndex(idx)}
                >
                  {editingListId === l.id ? (
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitEditList();
                        } else if (e.key === 'Escape') cancelEditList();
                      }}
                      onBlur={commitEditList}
                      className="flex-1 min-w-0 h-8 rounded-[6px] px-2 text-[14.5px] outline-none"
                      style={{ border: `1px solid ${theme.fg}`, background: 'transparent', color: theme.fg }}
                    />
                  ) : (
                    <button className="flex-1 min-w-0 text-left text-[15.5px] truncate" onClick={() => selectList(l.label)}>
                      {l.label}
                    </button>
                  )}
                  {editingListId !== l.id && (
                    <>
                      <span className="text-[13px]">{suttaLists.includes(l.label) ? '✓' : ''}</span>
                      <button
                        className="flex-none w-6 h-6 flex items-center justify-center rounded opacity-60"
                        title="List options"
                        onClick={() => setMenuOpenListId((m) => (m === l.id ? null : l.id))}
                      >
                        <MoreHorizontal size={14} strokeWidth={2} />
                      </button>
                    </>
                  )}
                </div>
                {confirmDeleteListId === l.id ? (
                  <div className="flex items-center gap-2 px-2 pb-2">
                    <span className="font-sans text-[12px] opacity-70">Delete "{l.label}"?</span>
                    <button
                      onClick={() => deleteList(l)}
                      className="font-sans text-[12px] font-semibold px-2 py-[3px] rounded border border-red-500/50 text-red-500"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteListId(null)}
                      className="font-sans text-[12px] px-2 py-[3px] rounded"
                      style={{ border: `1px solid ${theme.rule}`, opacity: 0.7 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  menuOpenListId === l.id && (
                    <div className="flex items-center gap-[6px] px-2 pb-2">
                      {!draft.trim() && (
                        <>
                          <button
                            title="Move up"
                            disabled={idx === 0}
                            onClick={() => moveList(l, -1)}
                            className="w-6 h-[22px] flex items-center justify-center rounded disabled:opacity-25"
                            style={{ border: `1px solid ${theme.rule}` }}
                          >
                            <ChevronUp size={13} strokeWidth={2} />
                          </button>
                          <button
                            title="Move down"
                            disabled={idx === filteredLists.length - 1}
                            onClick={() => moveList(l, 1)}
                            className="w-6 h-[22px] flex items-center justify-center rounded disabled:opacity-25"
                            style={{ border: `1px solid ${theme.rule}` }}
                          >
                            <ChevronDown size={13} strokeWidth={2} />
                          </button>
                        </>
                      )}
                      <button
                        title="Rename"
                        onClick={() => startEditList(l)}
                        className="w-6 h-[22px] flex items-center justify-center rounded"
                        style={{ border: `1px solid ${theme.rule}` }}
                      >
                        <Pencil size={12} strokeWidth={2} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => armDeleteList(l)}
                        className="w-6 h-[22px] flex items-center justify-center rounded text-red-500"
                        style={{ border: `1px solid ${theme.rule}` }}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'text' && (
          <div className="sc flex-1 min-h-0">
            <div className="flex gap-[9px] mb-1.5">
              {THEME_SWATCHES.map((t) => (
                <button
                  key={t.id}
                  className="flex-1 h-[52px] rounded-[10px] text-[14.5px]"
                  style={{ background: t.bg, color: t.fg, border: `1px solid ${currentTheme === t.id ? theme.fg : theme.rule}` }}
                  onClick={() => setTheme(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Size
              </span>
              <input type="range" min={15} max={24} step={1} value={fs} onChange={(e) => setFs(+e.target.value)} className="flex-1" style={{ accentColor: '#8A6A3B' }} />
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Line height
              </span>
              <input type="range" min={140} max={200} step={5} value={lh} onChange={(e) => setLh(+e.target.value)} className="flex-1" style={{ accentColor: '#8A6A3B' }} />
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Face
              </span>
              <div className="flex gap-2">
                {FACE_OPTIONS.map((f) => (
                  <button key={f.id} style={{ ...pill(face === f.id), fontSize: 12, padding: '5px 10px' }} onClick={() => setFace(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Pali
              </span>
              <button style={pill(allPali)} onClick={toggleAllPali}>
                {allPali ? 'Always shown' : 'On tap'}
              </button>
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Source
              </span>
              <span className="flex-1 text-[14.5px]">Sujato (2018)</span>
              <span className="font-sans text-[12.5px] opacity-45">change</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
