import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useCorpusSearch } from '../useCorpusSearch';
import type { Corpus, ListDef } from '../../lib/types';

// The text search's state, so a test can put the load mid-flight.
const state = vi.hoisted(() => ({ status: 'ready' as const as string }));

// A loaded text search that answers with the metadata hits plus one sutta only the text reaches,
// so a complete answer is visibly different from the metadata half on its own. Every hit comes back
// with a passage, as the worker cuts one for every row it can.
vi.mock('../../lib/search/textClient', () => ({
  beginTextSearchLoad: vi.fn(),
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => state.status,
  searchText: (_query: string, meta: Array<{ id: string; rank: number }>) =>
    Promise.resolve(
      [...meta.map(({ id, rank }) => ({ id, rank })), { id: 'dn9', rank: 4 }].map((hit) => ({
        ...hit,
        snippet: { text: 'a paragraph of this sutta', marks: [], segments: [7, 9] as [number, number] },
      }))
    ),
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
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

type Result = ReturnType<typeof useCorpusSearch>;

// Held still between renders, the way the contexts these come from hold them: a fresh object each
// render would rescan, and answer, on a loop.
const noNotes = {};
const noLists: never[] = [];
const noHighlights = {};
// A list whose own name answers the query, holding a sutta nothing else about it matches.
const listNamedPrime: ListDef[] = [
  { id: 'l1', label: 'Prime', parentId: null, kind: 'list', items: ['dn2'] },
];

function Probe({
  query,
  readingId,
  lists = noLists,
  onRender,
}: {
  query: string;
  readingId?: string;
  lists?: ListDef[];
  onRender: (result: Result) => void;
}) {
  onRender(useCorpusSearch(corpus, query, noNotes, lists, noHighlights, readingId));
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

  it('holds the first search of a sitting while the loaded text is scanned', async () => {
    state.status = 'ready';
    const seen: Result[] = [];
    const view = render(<Probe query="fruits" onRender={(r) => seen.push(r)} />);
    // The scan runs off the main thread and is seconds on a phone, so this frame is what the reader
    // looks at; the metadata half here would be replaced by a differently ordered list.
    expect(seen[0].textPending).toBe(true);
    expect(seen[0].hits).toEqual([]);

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
    // The first render was still waiting on the scan, which is the frame a return must not show.
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

  it('reports the held results as updating, until its own answer replaces them', async () => {
    const seen: Result[] = [];
    const view = render(<Probe query="lon" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));
    expect(seen.at(-1)!.updating).toBe(false);

    // Rows on screen, but the previous query's: what the spinner beside the results count stands
    // for. Never both — a pane drawing the "Searching sutta text…" state has no rows to mark.
    const typed = seen.length;
    view.rerender(<Probe query="long" onRender={(r) => seen.push(r)} />);
    expect(seen.at(-1)!.updating).toBe(true);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));
    expect(seen.at(-1)!.updating).toBe(false);
    for (const render of seen.slice(typed)) {
      expect(render.updating && render.textPending).toBe(false);
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

  it('opens the library on the same search run from the reader', async () => {
    state.status = 'ready';
    const reader: Result[] = [];
    const one = render(<Probe query="long" readingId="dn1" onRender={(r) => reader.push(r)} />);
    await waitFor(() => expect(reader.at(-1)!.hitsSettled).toBe(true));
    one.unmount();

    const library: Result[] = [];
    render(<Probe query="long" onRender={(r) => library.push(r)} />);
    expect(library[0].hitsSettled).toBe(true);
  });

  it('leaves the reader on another sutta to wait for an answer carrying its own passages', async () => {
    state.status = 'ready';
    const first: Result[] = [];
    const one = render(<Probe query="long" readingId="dn1" onRender={(r) => first.push(r)} />);
    await waitFor(() => expect(first.at(-1)!.hitsSettled).toBe(true));
    one.unmount();

    const next: Result[] = [];
    render(<Probe query="long" readingId="dn2" onRender={(r) => next.push(r)} />);
    expect(next[0].hitsSettled).toBe(false);
    await waitFor(() => expect(next.at(-1)!.hitsSettled).toBe(true));
  });
});

describe('where a result opens', () => {
  it('drops the passage from a row its own title answered, which opens the sutta at the top', async () => {
    state.status = 'ready';
    const seen: Result[] = [];
    const view = render(<Probe query="prime" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));

    const hits = seen.at(-1)!.hits;
    expect(hits.find((hit) => hit.id === 'dn1')!.snippet).toBeUndefined();
    // The sutta the text alone reached has nothing else to show for itself.
    expect(hits.find((hit) => hit.id === 'dn9')!.snippet).toBeDefined();
    view.unmount();
  });

  it('keeps it on a sutta reached through a list’s name, which the row says nothing about', async () => {
    state.status = 'ready';
    const seen: Result[] = [];
    const view = render(<Probe query="prime" lists={listNamedPrime} onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));

    // Without the passage the library drops this row altogether, the matched list standing for it.
    expect(seen.at(-1)!.hits.find((hit) => hit.id === 'dn2')!.snippet).toBeDefined();
    view.unmount();
  });
});

describe('the first keystroke of a search', () => {
  it('waits rather than reporting an empty result the scan has not reached yet', async () => {
    state.status = 'ready';
    const seen: Result[] = [];
    const view = render(<Probe query="" onRender={(r) => seen.push(r)} />);

    // Every render from the keystroke on. The query is a render ahead of the results here, so a
    // pane drawing its empty state off `hits` alone would say nothing matched before anything was
    // scanned.
    const typed = seen.length;
    view.rerender(<Probe query="prime" onRender={(r) => seen.push(r)} />);
    await waitFor(() => expect(seen.at(-1)!.hitsSettled).toBe(true));
    for (const render of seen.slice(typed)) {
      if (render.hits.length === 0 && render.listHits.length === 0) expect(render.textPending).toBe(true);
    }
    view.unmount();
  });
});
