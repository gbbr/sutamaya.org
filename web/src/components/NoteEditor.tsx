import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NOTE_MAX_LENGTH } from '../lib/textLimits';

// How many characters from the cap the count appears, where it reads as a warning rather than as a
// running score over every note.
const COUNT_FROM_REMAINING = 100;

interface NoteEditorProps {
  value: string;
  onSubmit: (text: string) => void;
  placeholder?: string;
  // The box's height, fixed: a note is a line or two, and a longer one scrolls.
  rows?: number;
  textareaClassName: string;
  textareaStyle?: CSSProperties;
  // Bumped to put the cursor in the box on demand; `autoFocus` fires only on mount, which misses
  // a shortcut pressed while the panel is already open.
  focusSignal?: number;
}

// A note is written like a note rather than sent like a message: Enter is a new line, and saving
// happens on its own — leaving the field commits, as does the editor going off screen with a draft
// pending, and Cmd/Ctrl+Enter for anyone who wants a deliberate keystroke. Nothing typed is ever
// dropped, which is why Escape out of the reader's panel saves rather than cancels.
//
// The draft is held here rather than written per keystroke, and resyncs whenever `value` changes —
// a sutta switch, or another device's edit arriving mid-write.
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
    // The caret at the end, never a selection over the whole note, which one keystroke would wipe.
    box.setSelectionRange(box.value.length, box.value.length);
    // Scrolled to the caret, which a note longer than the box would leave off screen.
    box.scrollTop = box.scrollHeight;
  }, [focusSignal]);

  const dirty = draft !== value;
  const remaining = NOTE_MAX_LENGTH - draft.length;
  const counting = dirty && remaining <= COUNT_FROM_REMAINING;

  function submit() {
    if (draft !== value) onSubmit(draft);
  }

  // Commits the draft on unmount, which is what catches the panel being closed with a note
  // half-written — neither blur nor the shortcut fires there. Through a ref, so the cleanup stays
  // mount-scoped and still sees the final draft; `submit` writes nothing when it matches.
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
