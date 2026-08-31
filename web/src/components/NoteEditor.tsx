import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NOTE_MAX_LENGTH } from '../lib/textLimits';

// How close to the cap the count starts showing. A running score over every note would make the
// limit the point of the box; near the end it's a warning, which is the only time it's useful.
const COUNT_FROM_REMAINING = 100;

interface NoteEditorProps {
  value: string;
  onSubmit: (text: string) => void;
  placeholder?: string;
  // Fixed: a note is an annotation — a line or two to recognise the sutta by later — and a box
  // that stays that size says so. Longer notes scroll rather than growing the field.
  rows?: number;
  textareaClassName: string;
  textareaStyle?: CSSProperties;
  // Bumped by a caller (ReaderPage's "n" shortcut, or tapping the note in the text) to put the
  // cursor in the textarea on demand.
  // `autoFocus` only fires on mount, which misses a shortcut pressed while the panel is open.
  focusSignal?: number;
}

// A note is written like a note, not sent like a message: Enter is a new line, and saving happens
// on its own — leaving the field commits, as does the editor going off screen with a draft pending.
// Cmd/Ctrl+Enter commits on the spot for anyone who wants a deliberate keystroke. Nothing typed is
// ever dropped, which is why Escape out of the reader's panel saves rather than cancels.
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
  focusSignal,
}: NoteEditorProps) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!focusSignal) return;
    const box = textareaRef.current;
    if (!box) return;
    box.focus();
    // Caret at the end, never a selection over the whole note: this box is usually opened on an
    // existing note to add to it, and a selected note is one keystroke from being wiped.
    box.setSelectionRange(box.value.length, box.value.length);
    // A note longer than the box would leave that caret off screen; scrolling to the bottom keeps
    // it in view. Stays at 0 for a note that fits.
    box.scrollTop = box.scrollHeight;
  }, [focusSignal]);

  const dirty = draft !== value;
  const remaining = NOTE_MAX_LENGTH - draft.length;
  const counting = dirty && remaining <= COUNT_FROM_REMAINING;

  function submit() {
    if (draft !== value) onSubmit(draft);
  }

  // Cmd/Ctrl+Enter and blur both commit the draft, but neither fires when the editor is taken off
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
      {/* Nothing is said about saving, in either direction: the note saves itself, and a word about
          it — a Save button, or a "Saved" afterwards — would only make a question of something the
          reader never has to think about. The one thing worth saying is that the cap is close. */}
      {counting && (
        <div className="mt-1.5 font-sans text-ui-xs" style={{ opacity: 0.5 }}>
          {remaining} character{remaining === 1 ? '' : 's'} left
        </div>
      )}
    </div>
  );
}
