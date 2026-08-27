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
  // Bumped by a caller (ReaderPage's "n" shortcut) to focus and select the textarea on demand.
  // `autoFocus` only fires on mount, which misses a shortcut pressed while the panel is open.
  focusSignal?: number;
}

// A note is a discrete edit, not a live stream. Enter commits it, so there is no newline key at
// all; leaving the field commits, as does the editor going off screen with a draft pending, and the
// Save button is there for anyone who'd rather not remember either. Nothing typed is ever dropped,
// which is why Escape out of the reader's panel saves rather than cancels.
//
// Keeps its own draft state, so nothing is written per keystroke, and resyncs whenever `value`
// changes — switching suttas, or a note edited on another device arriving mid-edit.
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

  // Enter, blur and Save all commit the draft, but none of them fire when the editor is taken off
  // screen — and Escape closes the reader's panel (see useReaderKeyboard) without moving focus
  // first, so a half-written note would go with it. Committing from the unmount cleanup covers
  // that, and closing the reader outright with it. The ref lets that cleanup stay mount-scoped and
  // still see the final draft; `submit` writes nothing when the draft matches what is stored.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => () => submitRef.current(), []);

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
          <span className="font-sans text-ui-xs" style={{ opacity: 0.5 }}>
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
