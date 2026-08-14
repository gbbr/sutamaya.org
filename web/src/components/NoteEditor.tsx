import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NOTE_MAX_LENGTH } from '../lib/textLimits';

interface NoteEditorProps {
  value: string;
  onSubmit: (text: string) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName: string;
  textareaStyle?: CSSProperties;
  saveButtonClassName: string;
  saveButtonStyle?: CSSProperties;
  // Bumped by a caller (see ReaderPage's "n" shortcut) to imperatively focus+select the
  // textarea on demand — a plain `autoFocus` only fires once, on mount, which misses the case
  // where this editor is already mounted (panel already open) and the shortcut fires again.
  focusSignal?: number;
}

// A note is a discrete edit, not a live stream — Enter commits it (no newline key at all),
// leaving the field also commits, and the Save button is there for anyone who'd
// rather not remember either shortcut. Keeps its own draft state so nothing round-trips to the
// server per keystroke; only resyncs from `value` when it changes out from under the draft
// (switching suttas, or a fresh fetch), not while the user is actively mid-edit.
export function NoteEditor({
  value,
  onSubmit,
  placeholder,
  rows = 2,
  textareaClassName,
  textareaStyle,
  saveButtonClassName,
  saveButtonStyle,
  focusSignal,
}: NoteEditorProps) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!focusSignal) return;
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, [focusSignal]);

  const dirty = draft !== value;
  const remaining = NOTE_MAX_LENGTH - draft.length;

  function submit() {
    if (draft !== value) onSubmit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div data-component="NoteEditor">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={submit}
        rows={rows}
        placeholder={placeholder}
        maxLength={NOTE_MAX_LENGTH}
        className={textareaClassName}
        style={textareaStyle}
      />
      {dirty && (
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="font-sans text-[11px]" style={{ opacity: 0.5 }}>
            {remaining} character{remaining === 1 ? '' : 's'} left
          </span>
          <button type="button" className={saveButtonClassName} style={saveButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={submit}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
