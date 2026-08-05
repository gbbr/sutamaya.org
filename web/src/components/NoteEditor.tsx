import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';

interface NoteEditorProps {
  value: string;
  onSubmit: (text: string) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName: string;
  textareaStyle?: CSSProperties;
  saveButtonClassName: string;
  saveButtonStyle?: CSSProperties;
}

// A note is a discrete edit, not a live stream — Enter commits it (Shift+Enter for a literal
// newline), leaving the field also commits, and the Save button is there for anyone who'd
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
}: NoteEditorProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const dirty = draft !== value;

  function submit() {
    if (draft !== value) onSubmit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div data-component="NoteEditor">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={submit}
        rows={rows}
        placeholder={placeholder}
        className={textareaClassName}
        style={textareaStyle}
      />
      {dirty && (
        <button type="button" className={saveButtonClassName} style={saveButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Save
        </button>
      )}
    </div>
  );
}
