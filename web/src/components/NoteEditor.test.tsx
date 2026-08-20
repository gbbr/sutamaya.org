import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoteEditor } from './NoteEditor';

function renderEditor(overrides: Partial<Parameters<typeof NoteEditor>[0]> = {}) {
  const onSubmit = vi.fn();
  const utils = render(
    <NoteEditor
      value=""
      onSubmit={onSubmit}
      textareaClassName="note"
      saveButtonClassName="save"
      {...overrides}
    />
  );
  return { onSubmit, ...utils };
}

describe('NoteEditor', () => {
  it('commits the draft on Enter', async () => {
    const { onSubmit } = renderEditor();
    await userEvent.type(screen.getByRole('textbox'), 'a thought{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('a thought');
  });

  it('commits the draft on blur', async () => {
    const { onSubmit } = renderEditor();
    await userEvent.type(screen.getByRole('textbox'), 'a thought');
    await userEvent.tab();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('a thought');
  });

  // The reader's panel is unmounted outright by Escape (see useReaderKeyboard), which moves no
  // focus and so fires no blur — without the unmount commit the half-written note is simply gone.
  it('commits a pending draft when it is unmounted without blurring', async () => {
    const { onSubmit, unmount } = renderEditor();
    await userEvent.type(screen.getByRole('textbox'), 'a thought');
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('a thought');
  });

  it('writes nothing on unmount when the draft matches what is stored', async () => {
    const { onSubmit, unmount } = renderEditor({ value: 'already saved' });
    unmount();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // A draft already committed by Enter must not be written a second time by the unmount that
  // follows — a duplicate write would re-stamp the note's mtime and push it again.
  it('does not re-commit on unmount after the draft was already saved', async () => {
    const onSubmit = vi.fn();
    const { rerender, unmount } = render(
      <NoteEditor value="" onSubmit={onSubmit} textareaClassName="note" saveButtonClassName="save" />
    );
    await userEvent.type(screen.getByRole('textbox'), 'a thought{Enter}');
    // What the parent does once the note has landed in the mirror.
    rerender(
      <NoteEditor value="a thought" onSubmit={onSubmit} textareaClassName="note" saveButtonClassName="save" />
    );
    unmount();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('a thought');
  });

  it('clears a note when the draft is emptied', async () => {
    const { onSubmit } = renderEditor({ value: 'old note' });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.tab();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('');
  });
});
