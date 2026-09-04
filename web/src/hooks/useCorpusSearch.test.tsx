import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useCorpusSearch } from './useCorpusSearch';
import type { Corpus } from '../lib/types';

// The text search's state, so a test can put the load mid-flight.
const state = vi.hoisted(() => ({ status: 'ready' as const as string }));

// A loaded text search that answers with the metadata hits plus one sutta only the text reaches,
// so a complete answer is visibly different from the metadata half on its own.
vi.mock('../lib/search/textClient', () => ({
  beginTextSearchLoad: vi.fn(),
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => state.status,
  searchText: (_query: string, meta: Array<{ id: string; rank: number }>) =>
    Promise.resolve([...meta.map(({ id, rank }) => ({ id, rank })), { id: 'dn9', rank: 1 }]),
}));

const corpus: Corpus = {
  nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 3 }],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn', en: 'The Prime Net', pali: 'Brahmajāla', blurb: 'A long discourse', min: 5 },
    dn2: { ref: 'DN 2', node: 'dn', en: 'The Fruits of Life', pali: 'Sāmaññaphala', blurb: 'A long discourse', min: 5 },
    dn9: { ref: 'DN 9', node: 'dn', en: 'With Potthapada', pali: 'Poṭṭhapāda', blurb: 'On perception', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  dictionaryVersion: 'dict-v1',
};

type Result = ReturnType<typeof useCorpusSearch>;

// Held still between renders, the way the contexts these come from hold them: a fresh object each
// render would rescan, and answer, on a loop.
const noNotes = {};
const noLists: never[] = [];
const noHighlights = {};

function Probe({ query, onRender }: { query: string; onRender: (result: Result) => void }) {
  onRender(useCorpusSearch(corpus, query, noNotes, noLists, noHighlights));
  return null;
}

describe('a search waiting on the sutta text', () => {
  it('shows nothing rather than the metadata half, which would reorder when the text lands', async () => {
    state.status = 'loading';
    const seen: Result[] = [];
    const view = render(<Probe query="prime" onRender={(r) => seen.push(r)} />);
    // The metadata half has a hit for this query; the point is that it is not what renders.
    expect(seen.at(-1)!.textPending).toBe(true);
    expect(seen.at(-1)!.hits).toEqual([]);
    expect(seen.at(-1)!.hitsSettled).toBe(false);

    state.status = 'ready';
    view.rerender(<Probe query="prime" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));
    expect(seen.at(-1)!.textPending).toBe(false);
    expect(seen.at(-1)!.hits.map((hit) => hit.id)).toContain('dn9');
    view.unmount();
  });
});

describe('a search that has already been answered', () => {
  it('opens a later mount on its complete results, in the first render', async () => {
    const first: Result[] = [];
    const one = render(<Probe query="long" onRender={(r) => first.push(r)} />);
    await waitFor(() => expect(first.at(-1)!.hitsSettled).toBe(true));
    const answered = first.at(-1)!.hits.map((hit) => hit.id);
    expect(answered).toContain('dn9');
    // The first render had the metadata half only, which is the frame a return must not show.
    expect(first[0].hitsSettled).toBe(false);
    one.unmount();

    // The mount a closed reader makes. Settled in its first render, so the pane's scroll restore
    // runs before anything is painted.
    const back: Result[] = [];
    render(<Probe query="long" onRender={(r) => back.push(r)} />);
    expect(back[0].hitsSettled).toBe(true);
    expect(back[0].hits.map((hit) => hit.id)).toEqual(answered);
  });

  it('stays on screen while the next keystroke is answered', async () => {
    const seen: Result[] = [];
    const view = render(<Probe query="lon" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));

    // Every render from the keystroke on. Dropping to the metadata half here would take the text
    // hit and every snippet off the screen for a frame, and rebuild the list on the next one.
    const typed = seen.length;
    view.rerender(<Probe query="long" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));
    for (const render of seen.slice(typed)) {
      expect(render.hits.map((hit) => hit.id)).toContain('dn9');
    }
  });

  it('leaves a mount on a different query to wait for its own answer', async () => {
    const first: Result[] = [];
    const one = render(<Probe query="long" onRender={(r) => first.push(r)} />);
    await waitFor(() => expect(first.at(-1)!.hitsSettled).toBe(true));
    one.unmount();

    const other: Result[] = [];
    render(<Probe query="perception" onRender={(r) => other.push(r)} />);
    expect(other[0].hitsSettled).toBe(false);
    await waitFor(() => expect(other.at(-1)!.hitsSettled).toBe(true));
  });
});
