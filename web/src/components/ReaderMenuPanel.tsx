import { useRef, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import type { SegmentFile } from '../lib/corpus';
import type { ReaderFace, ReaderTheme, ThemeColors } from '../lib/types';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: 'notes' | 'lists' | 'text';
  segments: SegmentFile[] | null;
  onClose: () => void;
}

const THEME_SWATCHES: Array<{ id: ReaderTheme; label: string; bg: string; fg: string }> = [
  { id: 'light', label: 'Light', bg: '#FBFAF7', fg: '#1B1917' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E' },
  { id: 'dark', label: 'Dark', bg: '#191A1C', fg: '#E7E3DC' },
];
const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
];

export function ReaderMenuPanel({ suttaId, mobile, theme, initialTab, segments, onClose }: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const { notes, setNote, highlights, removeHighlight, lists, membership, toggleMembership, createList } = useUserData();
  const { theme: currentTheme, setTheme, fs, setFs, lh, setLh, face, setFace, allPali, toggleAllPali } = useReaderPrefs();
  const [draft, setDraft] = useState('');
  const listInput = useRef<HTMLInputElement>(null);

  const suttaHighlights = highlights[suttaId] || [];
  const suttaLists = membership[suttaId] || [];

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
      if (!suttaLists.includes(list.label)) toggleMembership(suttaId, list.label);
    } catch {
      // Signed out: createList() already triggered the Google sign-in prompt.
    }
  }
  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDraft();
    }
  }

  const tabBtn = (id: 'notes' | 'lists' | 'text', label: string) => (
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
          {tabBtn('notes', 'Notes')}
          {tabBtn('lists', 'Lists')}
          {tabBtn('text', 'Text')}
        </div>

        {tab === 'notes' && (
          <div className="sc flex-1 min-h-0">
            <div className="rounded-field mb-3.5 p-[11px_13px]" style={{ border: `1px solid ${theme.rule}`, padding: '11px 13px' }}>
              <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-[5px]">Sutta note</div>
              <textarea
                value={notes[suttaId] || ''}
                onChange={(e) => setNote(suttaId, e.target.value)}
                rows={2}
                placeholder="Add a note"
                className="w-full bg-transparent text-[16px] italic resize-none outline-none font-serif"
                style={{ border: 0, color: theme.fg }}
              />
            </div>
            {suttaHighlights.map((h) => (
              <div key={h.id} className="flex gap-2.5 items-start py-2.5" style={{ borderBottom: `1px solid ${theme.rule}` }}>
                <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: h.c }} />
                <span className="flex-1 text-sm leading-[1.45]">{(segments?.[h.i]?.en || '').slice(h.s, h.e).slice(0, 92) || `Segment ${h.i + 1}`}</span>
                <button className="flex items-center gap-1 font-sans text-[11.5px] opacity-45" onClick={() => removeHighlight(suttaId, h.id)}>
                  <Trash2 size={12} strokeWidth={1.75} />
                  Remove
                </button>
              </div>
            ))}
            {suttaHighlights.length === 0 && (
              <div className="font-sans text-[12.5px] opacity-40 py-1.5">Select text in the reading, then pick a colour.</div>
            )}
          </div>
        )}

        {tab === 'lists' && (
          <div className="sc flex-1 min-h-0">
            <input
              ref={listInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onDraftKey}
              placeholder="List name — return to create & add"
              className="w-full h-11 rounded-[10px] px-3 bg-transparent text-base outline-none"
              style={{ border: `1px solid #8A6A3B`, color: theme.fg }}
            />
            <div className="flex flex-wrap gap-1.5 my-3.5">
              {suttaLists.map((label) => (
                <button
                  key={label}
                  className="inline-flex items-center whitespace-nowrap rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px]"
                  style={{ background: theme.fg, color: theme.bg }}
                  onClick={() => toggleMembership(suttaId, label)}
                >
                  {label} ×
                </button>
              ))}
            </div>
            <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-1">Or pick from your lists</div>
            {lists.map((l) => (
              <button
                key={l.id}
                className="flex items-center gap-2.5 w-full text-left py-[11px]"
                style={{ borderBottom: `1px solid ${theme.rule}` }}
                onClick={() => toggleMembership(suttaId, l.label)}
              >
                <span className="flex-1 text-[15.5px]">{l.label}</span>
                <span className="text-[13px]">{suttaLists.includes(l.label) ? '✓' : ''}</span>
              </button>
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
