import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderRoutes } from '../../testRouter';

// The wash on the passage a search hit's snippet was drawn from: on while the reader arrives, off a
// moment later. It is an orientation cue, not an annotation — a passage that stayed washed would
// read as one of the reader's own highlights. The words the hit was found by stay marked there
// until the reader's next tap.

vi.mock('../../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
// LibraryPage reads it only for the Shift+D theme toggle; the real provider isn't mounted here.
vi.mock('../../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));
// The text search's answer to any query: dn1's second paragraph, found in its third line's Pali.
vi.mock('../../lib/search/textClient', () => ({
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => 'ready',
  beginTextSearchLoad: () => {},
  searchText: async () => [
    {
      id: 'dn1',
      rank: 6,
      saved: false,
      snippet: {
        text: 'Atha kho Tena kho pana',
        marks: [[18, 22]],
        under: 'A wanderer, in dispraise',
        segments: [1, 2],
        paliSegments: [2],
        markedBy: { queries: ['pana'], anywhere: false },
      },
    },
  ],
}));

import { useCorpus } from '../../context/CorpusContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useLayout } from '../../context/LayoutContext';
import { useReaderPrefs } from '../../context/ReaderPrefsContext';
import { ReaderPage } from '../ReaderPage';
import { LibraryPage } from '../LibraryPage';
import { SEARCH_PLACEHOLDER } from '../../lib/search/metadata';
import { tagIntent } from '../../lib/routeIntent';
import { OPEN_LINES_KEY } from '../../lib/storageKeys';
import type { Corpus } from '../../lib/types';

const corpus: Corpus = {
  nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn', en: 'The Prime Net', pali: 'Brahmajāla', blurb: '', min: 5 },
    dn2: { ref: 'DN 2', node: 'dn', en: 'The Fruits of the Ascetic Life', pali: 'Sāmaññaphala', blurb: '', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

const segments = [
  { key: 'dn1:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard' },
  { key: 'dn1:1.2', pali: 'Atha kho', en: 'A wanderer was walking' },
  { key: 'dn1:1.3', pali: 'Tena kho pana', en: 'They spoke in dispraise of the Buddha' },
];

// The sutta a step, or a second jump, lands on.
const segments2 = [
  { key: 'dn2:1.1', pali: 'Rājagahe viharati', en: 'He was staying at Rājagaha' },
  { key: 'dn2:1.2', pali: 'Tadavasari', en: 'The moon was full that night' },
  { key: 'dn2:1.3', pali: 'Atha kho rājā', en: 'Then the king spoke' },
];

const userDataDefaults: ReturnType<typeof useUserData> = {
  ready: true,
  lists: [],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
  syncStatus: 'synced',
  pendingCount: 0,
  lastSyncedAt: null,
  needsReauth: false,
  listMembers: () => [],
  createList: async () => {
    throw new Error('unused');
  },
  renameList: async () => {},
  removeList: async () => {},
  reorderLists: async () => {},
  reorderListItems: async () => {},
  toggleMembership: async () => {},
  addToList: async () => {},
  submitNote: async () => {},
  setHighlightSpan: async () => {},
  anchorHighlights: () => {},
  markVisited: () => {},
};

const routes = [{ path: '/read/:suttaId', element: <ReaderPage /> }];

// The segments inside the wash, by index.
function washed(container: HTMLElement): number[] {
  const wash = container.querySelector('[data-wash-block]');
  return wash ? [...wash.querySelectorAll('[data-seg]')].map((el) => Number(el.getAttribute('data-seg'))) : [];
}

// The words marked on the page, in reading order.
function markTexts(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll('mark')].map((el) => el.textContent);
}

// A segment's Pali line, present only while it is open.
function paliLine(container: HTMLElement, i: number): Element | null {
  return container.querySelector(`[data-reveal="pali"][data-reveal-seg="${i}"]`);
}

describe('the passage a search hit was drawn from', () => {
  beforeEach(() => {
    // Real time still runs, so the render's own awaits resolve; the marks' timers are what these
    // tests advance by hand.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = new Map<string, string>();
    for (const name of ['localStorage', 'sessionStorage']) {
      vi.stubGlobal(name, {
        getItem: (k: string) => store.get(`${name}:${k}`) ?? null,
        setItem: (k: string, v: string) => void store.set(`${name}:${k}`, String(v)),
        removeItem: (k: string) => void store.delete(`${name}:${k}`),
        clear: () => store.clear(),
      });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('dn1.json')
          ? Promise.resolve({ ok: true, json: async () => segments })
          : url.includes('dn2.json')
            ? Promise.resolve({ ok: true, json: async () => segments2 })
            : Promise.reject(new Error(`unexpected fetch: ${url}`))
      )
    );
    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isSignedIn: false,
      dataUserId: 'local-test',
      localUserId: 'local-test',
      loading: false,
      authError: null,
      signingIn: false,
      requestEmailCode: vi.fn(async () => {}),
      signInWithEmailCode: vi.fn(async () => {}),
      signInWithGoogleNative: vi.fn(async () => {}),
      signInWithAppleNative: vi.fn(async () => false),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
      deleteAccount: vi.fn(async () => {}),
      forgetAccount: vi.fn(async () => {}),
    });
    vi.mocked(useLayout).mockReturnValue({
      mobile: false,
      w: 1200,
      treeW: 264,
      paneW: { tree: 264, treeMax: 400 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
    vi.mocked(useReaderPrefs).mockReturnValue({
      resolvedTheme: 'light',
      fs: 18,
      lh: 165,
      face: 'serif',
      allPali: false,
      paliAbove: false,
      showNotes: true,
      showHighlights: true,
      setTheme: vi.fn(),
      setFs: vi.fn(),
      setLh: vi.fn(),
      setFace: vi.fn(),
      toggleAllPali: vi.fn(),
      togglePaliAbove: vi.fn(),
      toggleShowNotes: vi.fn(),
      toggleShowHighlights: vi.fn(),
      revealHighlights: vi.fn(),
      cycleTheme: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is washed on arrival', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ from: '/browse/dn/dn1?q=dispraise', fromView: 'list', segments: [1, 2] }),
    });
    await screen.findByText('They spoke in dispraise of the Buddha');

    // Every segment the snippet was cut from, as one wash, so it matches the line the reader picked;
    // the rest of the sutta is untouched, so the wash says which passage answered the search.
    await waitFor(() => expect(washed(container)).toEqual([1, 2]));
    // A hit in the English opens no Pali.
    expect(container.querySelector('[data-reveal="pali"]')).toBeNull();
  });

  // This page never unmounts between suttas, so the arrival's paragraph numbers have to go with
  // the navigation that carried them. Held any longer they wash a passage of the next sutta that
  // has nothing to do with the query — and, past its end, wash nothing and leave the scroll where
  // it was.
  it('does not follow a Prev/Next step into the next sutta', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ from: '/browse/dn/dn1?q=dispraise', fromView: 'list', segments: [1, 2] }),
    });
    await screen.findByText('They spoke in dispraise of the Buddha');

    // What step() sends: the origin it always carried, and no passage of its own.
    await act(() => router.navigate('/read/dn2', { state: { from: '/browse/dn/dn1?q=dispraise', fromView: 'list' } }));
    await screen.findByText('Then the king spoke');

    expect(washed(container)).toEqual([]);
  });

  // The reader's own search overlay jumps to a passage too, so a second intent has to replace the
  // one the reader arrived on rather than being held off behind it.
  it('is replaced by a later jump rather than held behind it', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ from: '/browse/dn/dn1?q=dispraise', fromView: 'list', segments: [1, 2] }),
    });
    await screen.findByText('They spoke in dispraise of the Buddha');

    await act(() => router.navigate('/read/dn2', { state: tagIntent({ segments: [0, 0] }) }));
    await screen.findByText('Then the king spoke');

    // Not the passage the reader arrived on, which names nothing in this sutta.
    await waitFor(() => expect(washed(container)).toEqual([0]));
  });

  // A wash that has faded is still in place; a new one there starts over.
  it('is washed again when the reader jumps to the same passage again', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ from: '/browse/dn/dn1?q=dispraise', fromView: 'list', segments: [1, 2] }),
    });
    await screen.findByText('They spoke in dispraise of the Buddha');
    await waitFor(() => expect(washed(container)).toEqual([1, 2]));
    const first = container.querySelector('[data-wash-block]');

    await act(() => router.navigate('/read/dn1', { state: tagIntent({ segments: [1, 2] }) }));

    await waitFor(() => expect(container.querySelector('[data-wash-block]')).not.toBe(first));
    expect(washed(container)).toEqual([1, 2]);
  });

  it('opens the Pali of the lines a hit in the Pali matched, and keeps it open past the wash', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ from: '/browse/dn/dn1?q=pana', fromView: 'list', segments: [1, 2], paliSegments: [2] }),
    });
    await screen.findByText('They spoke in dispraise of the Buddha');

    await waitFor(() => expect(paliLine(container, 2)).not.toBeNull());
    // Not a line of the passage the hit marked nothing in.
    expect(paliLine(container, 1)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(paliLine(container, 2)).not.toBeNull();
  });

  it('opens with the Pali a hit in the Library search matched', async () => {
    const { container } = renderRoutes([{ path: '/browse/:nodeId/*', element: <LibraryPage /> }, ...routes], '/browse/dn');
    const tree = within(container.querySelector('[data-component="TreePane"]')!);
    fireEvent.click(tree.getByRole('button', { name: 'Search' }));
    fireEvent.change(tree.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'pana' } });
    fireEvent.click((await screen.findByText('A wanderer, in dispraise')).closest('button')!);
    await screen.findByText('They spoke in dispraise of the Buddha');

    await waitFor(() => expect(paliLine(container, 2)).not.toBeNull());
    expect(paliLine(container, 1)).toBeNull();
    // Marked with the words it was found by, as its row marked them.
    expect(paliLine(container, 2)!.querySelector('mark')?.textContent).toBe('pana');
  });

  // The scroll centres the passage by measuring it, so a Pali line that opened after the measure
  // would push the passage off the place it was centred on.
  it('is scrolled to with its Pali already open', async () => {
    // Every frame runs at once, so the scroll measures whatever is on screen when it asks for one.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const measured: boolean[] = [];
    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === document.querySelector('[data-seg="2"]')?.parentElement) measured.push(!!this.querySelector('[data-reveal="pali"]'));
      return measure.call(this);
    });

    renderRoutes(routes, { pathname: '/read/dn1', state: tagIntent({ segments: [2, 2], paliSegments: [2] }) });
    await screen.findByText('They spoke in dispraise of the Buddha');

    await waitFor(() => expect(measured).not.toHaveLength(0));
    expect(measured.every(Boolean)).toBe(true);
  });

  // A return restores the scroll offset the reader left, which was measured with these lines open.
  it('has its Pali open again when the reader comes back, before the reading returns to its place', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [2, 2], paliSegments: [2] }),
    });
    await waitFor(() => expect(paliLine(container, 2)).not.toBeNull());
    // And a line whose Pali the reader opened with a tap.
    fireEvent.click(container.querySelector('[data-seg="0"]')!);
    await act(() => router.navigate('/read/dn2'));
    await screen.findByText('Then the king spoke');

    // Whether both lines were open each time the reading's offset was set.
    const openWhenScrolled: boolean[] = [];
    Object.defineProperty(container.querySelector('[data-component="ReaderPage"] .sc')!, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => void openWhenScrolled.push(!!paliLine(container, 0) && !!paliLine(container, 2)),
    });
    await act(() => router.navigate(-1));
    await screen.findByText('They spoke in dispraise of the Buddha');

    expect(openWhenScrolled).not.toHaveLength(0);
    expect(openWhenScrolled.every(Boolean)).toBe(true);
  });

  it('has its Pali closed when the reader chooses the sutta anew', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [2, 2], paliSegments: [2] }),
    });
    await waitFor(() => expect(paliLine(container, 2)).not.toBeNull());
    await act(() => router.navigate('/read/dn2'));
    await screen.findByText('Then the king spoke');

    await act(() => router.navigate('/read/dn1'));
    await screen.findByText('They spoke in dispraise of the Buddha');
    expect(paliLine(container, 2)).toBeNull();
  });

  it('keeps only the lines left open', async () => {
    const { container } = renderRoutes(routes, '/read/dn1');
    await screen.findByText('They spoke in dispraise of the Buddha');
    fireEvent.click(container.querySelector('[data-seg="0"]')!);
    fireEvent.click(container.querySelector('[data-seg="2"]')!);
    fireEvent.click(container.querySelector('[data-seg="2"]')!);

    expect(JSON.parse(localStorage.getItem(OPEN_LINES_KEY)!)).toEqual({ dn1: { pali: { 0: true }, notes: {} } });
  });

  it('keeps none of its Pali while all of it shows', async () => {
    vi.mocked(useReaderPrefs).mockReturnValue({ ...vi.mocked(useReaderPrefs)(), allPali: true });
    const { container } = renderRoutes(routes, '/read/dn1');
    await screen.findByText('They spoke in dispraise of the Buddha');
    fireEvent.click(container.querySelector('[data-seg="0"]')!);

    expect(localStorage.getItem(OPEN_LINES_KEY)).toBeNull();
  });

  it('is not washed when the reader was not sent to a segment', async () => {
    const { container } = renderRoutes(routes, { pathname: '/read/dn1', state: { from: '/browse/dn/dn1', fromView: 'list' } });
    await screen.findByText('They spoke in dispraise of the Buddha');

    expect(washed(container)).toEqual([]);
    expect(markTexts(container)).toEqual([]);
  });

  it('marks the words it was found by, in the passage it lands on, until the next tap', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [1, 2], markedBy: { queries: ['dispraise'], anywhere: false } }),
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['dispraise']));

    fireEvent.click(document.body);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(markTexts(container)).toEqual([]);
  });

  it('marks the Pali words of the lines it opened', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [1, 2], paliSegments: [2], markedBy: { queries: ['pana'], anywhere: false } }),
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['pana']));
    expect(paliLine(container, 2)!.querySelector('mark')?.textContent).toBe('pana');
  });

  // Ending the marks replaces the word under the tap, which would otherwise swallow what the tap
  // was for.
  it('does what a tap on a marked word always does, as it ends the marks', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [2, 2], markedBy: { queries: ['dispraise'], anywhere: false } }),
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['dispraise']));

    fireEvent.click(container.querySelector('mark')!);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(paliLine(container, 2)).not.toBeNull();
    expect(markTexts(container)).toEqual([]);
  });

  it('keeps the marks through a click that finishes selecting text', async () => {
    const { container } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [2, 2], markedBy: { queries: ['dispraise'], anywhere: false } }),
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['dispraise']));

    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'in dispraise' } as Selection);
    fireEvent.click(document.body);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(markTexts(container)).toEqual(['dispraise']);
  });

  // A tap on a row of the reader's search is both a tap and a jump to new marks.
  it('keeps the marks of the jump a tap makes', async () => {
    const { container, router } = renderRoutes(routes, {
      pathname: '/read/dn1',
      state: tagIntent({ segments: [2, 2], markedBy: { queries: ['dispraise'], anywhere: false } }),
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['dispraise']));

    fireEvent.click(document.body);
    await act(() => router.navigate('/read/dn2', { state: tagIntent({ segments: [2, 2], markedBy: { queries: ['king'], anywhere: false } }) }));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await waitFor(() => expect(markTexts(container)).toEqual(['king']));
  });
});
