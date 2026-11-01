import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoutes } from '../../testRouter';
import { peekSuttaText } from '../../lib/corpus/corpus';

// Covers the Reader sutta header's list-membership chips + highlight-count badge — consolidated
// onto the same <SuttaRowChips> component ListPane/TreePane/ReaderSearchOverlay use (see that
// component's own test for its rendering/theming contract). This file exercises the two bits of
// behavior specific to the Reader's usage: a chip click navigates to that list, and the badge
// click opens the Highlights panel tab — both wired via SuttaRowChips' onChipClick/
// onHighlightClick props rather than SuttaRowChips' own default (non-interactive) behavior.

vi.mock('../../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../../context/ReaderPrefsContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../context/ReaderPrefsContext')>(), useReaderPrefs: vi.fn(),
}));
// LibraryPage (rendered by the chip-navigation test) reads it only for the Shift+D theme toggle.
vi.mock('../../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../../context/CorpusContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useLayout } from '../../context/LayoutContext';
import { useReaderPrefs } from '../../context/ReaderPrefsContext';
import { LibraryPage } from '../LibraryPage';
import { ReaderPage } from '../ReaderPage';
import type { Corpus, Highlight } from '../../lib/types';

function buildCorpus(): Corpus {
  return {
    nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
    suttas: {
      dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    searchVersion: 'search-v1',
    dictionaryVersion: 'dict-v1',
  };
}

const highlight: Highlight = { id: 'h1', k0: 'dn1:1.1', o0: 0, k1: 'dn1:1.1', o1: 5, c: '#F0E3A8', m: '2026-01-01T00:00:00.000Z|dev' };
const loadedFonts = document.fonts;

const userDataDefaults: ReturnType<typeof useUserData> = {
  ready: true,
  lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] }],
  membership: { dn1: ['l1'] },
  notes: {},
  highlights: { dn1: [highlight] },
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

describe('ReaderPage sutta header chips', () => {
  beforeEach(() => {
    sessionStorage.clear();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    // Never resolves — this suite only cares about the header (title/chips/badge), which renders
    // off corpus/membership/highlights directly, not the fetched segment text (see
    // mobileSearchReaderFlow.test.tsx, which uses the same stub for the same reason).
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'reader@example.com', name: 'Reader', picture: null },
      isSignedIn: true,
      dataUserId: 'u1',
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
      showSegmentNumbers: false,
      toggleShowSegmentNumbers: vi.fn(),
      revealHighlights: vi.fn(),
      cycleTheme: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'fonts', { configurable: true, value: loadedFonts });
  });

  function renderReader(entry = '/read/dn1') {
    return renderRoutes(
      [
        { path: '/read/:suttaId', element: <ReaderPage /> },
        { path: '/browse/:nodeId/*', element: <LibraryPage /> },
      ],
      entry
    );
  }

  // Opening at /read/dn1 is a return, so the page is held back while its text loads — which in
  // this suite is forever. The header is rendered all the same, but a held-back button has no
  // accessible name, so the chips below are found by their text.
  it('holds the page back on a return while its text loads, showing only the loading note and not scrolling', async () => {
    const { container } = renderReader();
    const title = await screen.findByText('Brahmajala', { selector: 'h1' });
    expect(title.closest<HTMLElement>('[style*="visibility: hidden"]')).toBeTruthy();
    expect(screen.getByText('Loading…').closest('[style*="visibility: hidden"]')).toBeNull();
    expect(container.querySelector<HTMLElement>('.sc')?.style.overflowY).toBe('hidden');
    expect(container.querySelector('[data-segroot]')).toBeNull();
  });

  it('shows a chip for each list the sutta belongs to and a badge with its highlight count', async () => {
    renderReader();
    await screen.findByText('Brahmajala');
    expect(screen.getByText('Favorites').closest('button')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy(); // one highlight group -> badge count
  });

  it('clicking a chip navigates to that list, with dn1 selected', async () => {
    const { container } = renderReader();
    await screen.findByText('Brahmajala');
    fireEvent.click(screen.getByText('Favorites').closest('button')!);

    // Reader unmounts (path no longer matches /read/:suttaId) and ListPane shows the list it
    // navigated to, with dn1 as its item — dn1's own row there shows a "Favorites" chip too
    // (still a member of that list), alongside the pane's own "Favorites" header title, so this
    // checks for at least one match rather than a single unique one.
    await waitFor(() => expect(screen.queryByText('Brahmajala', { selector: 'h1' })).toBeNull());
    const listPane = () => within(container.querySelector('[data-component="ListPane"]')!);
    await waitFor(() => expect(listPane().getAllByText('Favorites').length).toBeGreaterThan(0));
    expect(listPane().getByText('Brahmajala')).toBeTruthy();
  });

  it('clicking the highlight badge opens the Highlights panel tab', async () => {
    renderReader();
    await screen.findByText('Brahmajala');
    fireEvent.click(screen.getByText('1'));

    // "Sutta note" only renders under the Highlights tab for a signed-in user (ReaderMenuPanel);
    // the one seeded highlight has no text to preview, this reader's fetch never resolving, so it
    // renders as the no-text fallback.
    expect(await screen.findByText('Sutta note')).toBeTruthy();
    expect(screen.getByText('Highlighted text')).toBeTruthy();
  });

  // So Space, Page Down and the arrow keys scroll the reading without a click first.
  it('puts focus on the reading as the sutta opens', async () => {
    const { container } = renderReader();
    await screen.findByText('Brahmajala');
    expect(document.activeElement).toBe(container.querySelector('[data-component="ReaderPage"] .sc'));
  });

  function translations(ids: string[]) {
    const corpus = buildCorpus();
    const template = corpus.suttas.dn1;
    corpus.suttas = Object.fromEntries(ids.map((id) => [id, {
      ...template, ref: id, en: `Title ${id}`,
      by: { bodhi: `https://suttacentral.net/${id}/en/bodhi`, thanissaro: `https://www.dhammatalks.org/suttas/${id}.html` },
    }]));
    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = url.split('/').pop()!.replace('.json', '');
      const by = url.includes('/bodhi/') ? 'bodhi' : url.includes('/thanissaro/') ? 'thanissaro' : 'sujato';
      return { ok: true, json: async () => [{
        key: `${id}:2.7`, pali: `Pali paired with ${by}`, en: `${by} English for ${id}`,
        note: `<p>His note. <a href="/read/${id}?by=${by}&at=2.7">Same line</a></p>`,
      }] };
    }));
    return corpus;
  }

  function chooseTranslation(name: string) {
    fireEvent.click(screen.getByRole('button', { name: /^Translation:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name }));
  }

  it('has no translator picker when only Sujato is available', () => {
    renderReader();
    expect(screen.queryByRole('button', { name: /^Translation:/ })).toBeNull();
  });

  it('offers only available translations and lets the keyboard choose and dismiss', async () => {
    const corpus = translations(['mn11']);
    delete corpus.suttas.mn11.by!.thanissaro;
    const { router } = renderReader('/read/mn11');
    const user = userEvent.setup();
    await screen.findByText('sujato English for mn11');
    const originalKey = router.state.location.key;
    const picker = screen.getByRole('button', { name: 'Translation: Bhikkhu Sujato' });
    await user.click(picker);
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.getByRole('menuitemradio', { name: 'Bhikkhu Sujato' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Bhikkhu Sujato' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(picker);
    expect(router.state.location.key).toBe(originalKey);
    chooseTranslation('Bhikkhu Sujato');
    expect(router.state.location.key).toBe(originalKey);
    await user.click(picker);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('bodhi English for mn11')).toBeTruthy();
    expect(router.state.location.search).toBe('?by=bodhi');
  });

  it('returns to the original Sujato entry and scroll position with Back', async () => {
    const id = 'mn12';
    translations([id]);
    const { container, router } = renderReader(`/read/${id}`);
    await screen.findByText(`sujato English for ${id}`);
    const originalKey = router.state.location.key;
    const pane = container.querySelector<HTMLElement>('.sc')!;
    pane.scrollTop = 400;
    fireEvent.scroll(pane);
    chooseTranslation('Bhikkhu Bodhi');
    await screen.findByText(`bodhi English for ${id}`);
    expect(router.state.historyAction).toBe('PUSH');
    pane.scrollTop = 900;
    fireEvent.scroll(pane);
    chooseTranslation('Ṭhānissaro Bhikkhu');
    await screen.findByText(`thanissaro English for ${id}`);
    expect(router.state.historyAction).toBe('REPLACE');
    await act(() => router.navigate(-1));
    await screen.findByText(`sujato English for ${id}`);
    expect(router.state.location.key).toBe(originalKey);
    expect(pane.scrollTop).toBe(400);
    await act(() => router.navigate(1));
    expect(await screen.findByText(`thanissaro English for ${id}`)).toBeTruthy();
  });

  it('shows no return arrow after a translation switch, and closes the reader with Escape', async () => {
    translations(['mn13']);
    const { router } = renderReader('/read/mn13');
    await screen.findByText('sujato English for mn13');
    chooseTranslation('Bhikkhu Bodhi');
    await screen.findByText('bodhi English for mn13');
    expect(screen.queryByTitle('Back to mn13')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/browse\//));
  });

  it('resumes the latest reading after closing instead of an earlier consultation’s offset', async () => {
    translations(['mn22']);
    const { container, router } = renderReader('/read/mn22');
    await screen.findByText('sujato English for mn22');
    const pane = container.querySelector<HTMLElement>('.sc')!;
    pane.scrollTop = 400;
    fireEvent.scroll(pane);
    chooseTranslation('Bhikkhu Bodhi');
    await screen.findByText('bodhi English for mn22');
    await act(() => router.navigate(-1));
    await screen.findByText('sujato English for mn22');
    pane.scrollTop = 550;
    fireEvent.scroll(pane);
    fireEvent.click(within(container.querySelector('header')!).getByTitle('Close'));
    await waitFor(() => expect(screen.queryByText('Title mn22', { selector: 'h1' })).toBeNull());
    await act(() => router.navigate(-1));
    await screen.findByText('sujato English for mn22');
    expect(container.querySelector<HTMLElement>('.sc')!.scrollTop).toBe(550);
  });

  it.each(['cached', 'waiting for text', 'waiting for fonts'])(
    'keeps a missing line’s predecessor at the same height and returns through the picker: %s', async (mode) => {
    const id = mode === 'cached' ? 'mn14' : mode === 'waiting for text' ? 'mn20' : 'mn21';
    translations([id]);
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    const positions: Record<string, Record<string, number>> = {
      sujato: { '1.1': 300, '1.2': 410, '1.3': 440, '1.4': 500 },
      bodhi: { '1.1': 600, '1.2': 900, '1.4': 1000 },
      thanissaro: { '1.1': 300, '1.2': 410, '1.3': 440, '1.4': 500 },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const by = url.includes('/bodhi/') ? 'bodhi' : url.includes('/thanissaro/') ? 'thanissaro' : 'sujato';
      if (by === 'bodhi' && mode === 'waiting for text') await waiting;
      return { ok: true, json: async () => Object.keys(positions[by]).map((line) => ({
        key: `${id}:${line}`, en: `${by} ${line}`, pali: '',
      })) };
    }));
    const { container } = renderReader(`/read/${id}`);
    await screen.findByText('sujato 1.3');
    const pane = container.querySelector<HTMLElement>('.sc')!;
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === pane) return new DOMRect(0, 100, 600, 500);
      if (this.hasAttribute('data-seg')) {
        const [by, line] = this.textContent!.split(' ');
        return new DOMRect(0, 100 + positions[by][line] - pane.scrollTop, 400, 30);
      }
      return getRect.call(this);
    });
    pane.scrollTop = 400;
    fireEvent.scroll(pane);
    if (mode === 'waiting for fonts') {
      Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready: waiting } });
    }
    chooseTranslation('Bhikkhu Bodhi');
    if (mode !== 'cached') {
      expect(pane.style.overflowY).toBe('hidden');
      expect(pane.scrollTop).toBe(400);
      await act(async () => {
        Object.defineProperty(document, 'fonts', { configurable: true, value: loadedFonts });
        ready();
      });
    }
    await screen.findByText('bodhi 1.2');
    expect(pane.scrollTop).toBe(860);
    expect(screen.getByText('bodhi 1.2').getBoundingClientRect().top).toBe(140);
    chooseTranslation('Bhikkhu Sujato');
    await screen.findByText('sujato 1.2');
    expect(pane.scrollTop).toBe(370);
    expect(screen.getByText('sujato 1.2').getBoundingClientRect().top).toBe(140);
  });

  it('returns from a batch’s translation to the original inner-sutta entry without jumping to its start', async () => {
    translations(['dhp21-40']);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => [
      { key: 'dhp21:1', pali: '', en: `${url.includes('/thanissaro/') ? 'thanissaro' : 'sujato'} verse` },
      { key: 'dhp22:1', pali: '', en: 'Second verse of this batch' },
    ] })));
    const { container, router } = renderReader('/read/dhp22');
    await screen.findByText('sujato verse');
    const originalKey = router.state.location.key;
    const pane = container.querySelector<HTMLElement>('.sc')!;
    pane.scrollTop = 380;
    fireEvent.scroll(pane);
    chooseTranslation('Ṭhānissaro Bhikkhu');
    await screen.findByText('thanissaro verse');
    expect(router.state.location.pathname).toBe('/read/dhp21-40');
    await act(() => router.navigate(-1));
    await screen.findByText('sujato verse');
    expect(router.state.location.pathname).toBe('/read/dhp22');
    expect(router.state.location.key).toBe(originalKey);
    expect(pane.scrollTop).toBe(380);
  });

  it('preloads alternatives before the displayed text arrives and switches from the cache offline', async () => {
    translations(['mn15']);
    const fetchText = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/data/text/mn15.json'
      ? new Promise(() => {}) : fetchText(url)));
    renderReader('/read/mn15');
    await waitFor(() => {
      expect(peekSuttaText('mn15', 'bodhi')).toBeTruthy();
      expect(peekSuttaText('mn15', 'thanissaro')).toBeTruthy();
    });
    expect(screen.queryByText('sujato English for mn15')).toBeNull();
    vi.mocked(fetch).mockClear().mockRejectedValue(new Error('offline'));
    chooseTranslation('Bhikkhu Bodhi');
    expect(screen.getByText('bodhi English for mn15')).toBeTruthy();
    chooseTranslation('Ṭhānissaro Bhikkhu');
    expect(screen.getByText('thanissaro English for mn15')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preloads the opened sutta’s alternatives and only Sujato for its neighbours', async () => {
    translations(['mn16', 'mn17', 'mn18']);
    renderReader('/read/mn17?by=bodhi');
    await screen.findByText('bodhi English for mn17');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/data/text/mn18.json'));
    expect(fetch).toHaveBeenCalledWith('/data/text/mn17.json');
    expect(fetch).toHaveBeenCalledWith('/data/text/thanissaro/mn17.json');
    expect(fetch).toHaveBeenCalledWith('/data/text/mn16.json');
    expect(fetch).not.toHaveBeenCalledWith('/data/text/bodhi/mn16.json');
    expect(fetch).not.toHaveBeenCalledWith('/data/text/thanissaro/mn18.json');
  });

  it('keeps the main text readable after a failed preload and retries on choosing that translation', async () => {
    translations(['mn19']);
    const fetchText = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/bodhi/')
      ? Promise.resolve({ ok: false, status: 503 }) : fetchText(url)));
    renderReader('/read/mn19');
    await screen.findByText('sujato English for mn19');
    expect(screen.queryByText(/Couldn't load this sutta/)).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/data/text/bodhi/mn19.json');
    vi.mocked(fetch).mockClear().mockImplementation(fetchText);
    chooseTranslation('Bhikkhu Bodhi');
    expect(await screen.findByText('bodhi English for mn19')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/data/text/bodhi/mn19.json');
  });

  it('reads Bodhi at the addressed line with his Pali and notes, keeping Sujato highlights out of his text', async () => {
    translations(['mn1']);
    const anchorHighlights = vi.fn();
    vi.mocked(useUserData).mockReturnValue({
      ...userDataDefaults, anchorHighlights,
      highlights: { mn1: [{ ...highlight, k0: 'mn1:2.7', k1: 'mn1:2.7' }] },
    });
    const { container, router } = renderReader('/read/mn1?by=bodhi&at=2.7');
    const text = await screen.findByText('bodhi English for mn1');
    expect(screen.getByRole('link', { name: 'Bhikkhu Bodhi' })).toHaveAttribute('href', 'https://suttacentral.net/mn1/en/bodhi');
    expect(container.querySelector('[data-wash-block] [data-seg]')).toBe(text.closest('[data-seg]'));
    expect(container.querySelector('[data-hl-id]')).toBeNull();
    expect(anchorHighlights).not.toHaveBeenCalled();
    fireEvent.click(text);
    expect(await screen.findByText('Pali', { selector: '.pw' })).toBeTruthy();
    expect(container.querySelector('[data-reveal="pali"]')?.textContent).toBe('Pali paired with bodhi');
    fireEvent.click(container.querySelector('[data-seg] sup')!);
    expect(await screen.findByText('His note.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Same line' }));
    expect(router.state.location.search).toContain('by=bodhi');
    fireEvent.keyDown(window, { key: 'h' });
    expect(await screen.findByText('Select text in the reading, then pick a colour.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Other translations/ }));
    expect(screen.getByRole('region', { name: 'Sujato highlights' })).toBeTruthy();
  });

  it.each(['bodhi', 'thanissaro'] as const)('creates a highlight in %s from the selection popup', async (by) => {
    const id = by === 'bodhi' ? 'mn36' : 'mn37';
    translations([id]);
    const setHighlightSpan = vi.fn();
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, setHighlightSpan });
    const { container } = renderReader(`/read/${id}?by=${by}`);
    await screen.findByText(`${by} English for ${id}`);
    const selected = container.querySelector('[data-seg]')!;
    const node = document.createTreeWalker(selected, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(selected);
    await waitFor(() => expect(container.querySelector('[data-component="HighlightPopup"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-component="HighlightPopup"] button')!);
    await waitFor(() => expect(setHighlightSpan).toHaveBeenCalledWith(id, { k0: `${id}:2.7`, o0: 0, k1: `${id}:2.7`, o1: 5 }, '#F0E3A8', by));
  });

  function translationHighlights(id: string): Highlight[] {
    return (['sujato', 'bodhi', 'thanissaro'] as const).map((by) => ({
      ...highlight, id: by, ...(by === 'sujato' ? {} : { by }), k0: `${id}:2.7`, k1: `${id}:2.7`, o1: 200,
    }));
  }

  it.each(['sujato', 'bodhi', 'thanissaro'] as const)('paints only %s highlights and counts all translations in the header', async (by) => {
    const id = by === 'sujato' ? 'mn30' : by === 'bodhi' ? 'mn31' : 'mn32';
    translations([id]);
    const rows = translationHighlights(id);
    rows.push({ ...rows[0], id: 'missing', by: 'bodhi', k0: `${id}:missing`, k1: `${id}:missing` });
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, highlights: { [id]: rows } });
    const { container } = renderReader(`/read/${id}${by === 'sujato' ? '' : `?by=${by}`}`);
    await waitFor(() => expect(container.querySelector('[data-hl-id]')).not.toBeNull());
    expect(Array.from(container.querySelectorAll('[data-hl-id]')).map((el) => el.getAttribute('data-hl-id'))).toEqual([by]);
    expect(container.querySelector('[data-hl-id]')!.textContent).toBe(`${by} English for ${id}`);
    expect(screen.getByRole('button', { name: '4 highlights' })).toBeTruthy();
  });

  it('lists the current highlights first, groups other translators in switcher order and removes within each translation', async () => {
    const id = 'mn33';
    translations([id]);
    const setHighlightSpan = vi.fn();
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, setHighlightSpan, highlights: { [id]: translationHighlights(id) } });
    const { container, router } = renderReader(`/read/${id}?by=bodhi`);
    await waitFor(() => expect(container.querySelector('[data-hl-id="bodhi"]')).not.toBeNull());
    fireEvent.keyDown(window, { key: 'h' });
    const panel = container.querySelector('[data-component="ReaderMenuPanel"]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: /Other translations/ }));
    await within(panel).findByRole('button', { name: `thanissaro English for ${id}` });
    expect(within(panel).getAllByRole('region').map((section) => section.getAttribute('aria-label'))).toEqual(['Sujato highlights', 'Ṭhānissaro highlights']);
    const previews = within(panel).getAllByRole('button').filter((button) => button.textContent?.includes('English for'));
    expect(previews.map((button) => button.textContent)).toEqual(['bodhi', 'sujato', 'thanissaro'].map((by) => `${by} English for ${id}`));
    for (const section of within(panel).getAllByRole('region')) {
      expect(within(section).getByRole('heading').lastChild?.textContent).toBe('1');
    }
    for (const button of within(panel).getAllByRole('button', { name: 'Remove highlight' })) fireEvent.click(button);
    expect(setHighlightSpan.mock.calls.map((call) => call[3])).toEqual(['bodhi', 'sujato', 'thanissaro']);
    expect(setHighlightSpan).toHaveBeenCalledWith(id, { k0: `${id}:2.7`, o0: 0, k1: `${id}:2.7`, o1: 200 }, null, 'bodhi');
    expect(router.state.location.search).toBe('?by=bodhi');
  });

  it('opens other translators at their highlights in one consultation step and restores Sujato on Back', async () => {
    const id = 'mn34';
    translations([id]);
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, highlights: { [id]: translationHighlights(id) } });
    const { container, router } = renderReader(`/read/${id}`);
    await waitFor(() => expect(container.querySelector('[data-hl-id="sujato"]')).not.toBeNull());
    const pane = container.querySelector<HTMLElement>('.sc')!;
    const originalKey = router.state.location.key;
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === pane) return new DOMRect(0, 100, 600, 500);
      if (this.dataset.hlId) {
        const top = this.dataset.hlId === 'bodhi' ? 1000 : 1200;
        return new DOMRect(0, 100 + top - pane.scrollTop, 400, 30);
      }
      return getRect.call(this);
    });
    pane.scrollTop = 320;
    fireEvent.scroll(pane);
    for (const by of ['bodhi', 'thanissaro']) {
      fireEvent.keyDown(window, { key: 'h' });
      const panel = container.querySelector('[data-component="ReaderMenuPanel"]') as HTMLElement;
      fireEvent.click(within(panel).getByRole('button', { name: /Other translations/ }));
      fireEvent.click(await within(panel).findByRole('button', { name: `${by} English for ${id}` }));
      await waitFor(() => expect(container.querySelector(`[data-hl-id="${by}"]`)).not.toBeNull());
      expect(new URLSearchParams(router.state.location.search).get('by')).toBe(by);
      expect(router.state.historyAction).toBe(by === 'bodhi' ? 'PUSH' : 'REPLACE');
      expect(pane.scrollTop).toBe(by === 'bodhi' ? 765 : 965);
      expect(container.querySelector('[data-component="ReaderMenuPanel"]')).toBeNull();
    }
    await act(() => router.navigate(-1));
    await waitFor(() => expect(container.querySelector('[data-hl-id="sujato"]')).not.toBeNull());
    expect(router.state.location.key).toBe(originalKey);
    expect(pane.scrollTop).toBe(320);
  });

  it('shows the fallback while an alternative loads, then previews its own words', async () => {
    const id = 'mn35';
    translations([id]);
    const fetchText = vi.mocked(fetch).getMockImplementation()!;
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).includes('/bodhi/')) await waiting;
      return fetchText(...args);
    });
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, highlights: { [id]: translationHighlights(id) } });
    const { container } = renderReader(`/read/${id}`);
    await waitFor(() => expect(container.querySelector('[data-hl-id="sujato"]')).not.toBeNull());
    fireEvent.keyDown(window, { key: 'h' });
    fireEvent.click(screen.getByRole('button', { name: /Other translations/ }));
    const bodhi = screen.getByRole('region', { name: 'Bodhi highlights' });
    expect(within(bodhi).getByRole('button', { name: 'Highlighted text' })).toBeTruthy();
    await act(async () => ready());
    expect(await within(bodhi).findByRole('button', { name: `bodhi English for ${id}` })).toBeTruthy();
  });

  it.each(['consulted', 'directly addressed'])('opens a Sujato highlight from a %s alternative at the span, rather than the saved offset', async (mode) => {
    const id = mode === 'consulted' ? 'mn38' : 'mn39';
    translations([id]);
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, highlights: { [id]: translationHighlights(id) } });
    const { container, router } = renderReader(`/read/${id}${mode === 'consulted' ? '' : '?by=bodhi'}`);
    await waitFor(() => expect(container.querySelector('[data-hl-id]')).not.toBeNull());
    const originalKey = router.state.location.key;
    if (mode === 'consulted') {
      chooseTranslation('Bhikkhu Bodhi');
      await waitFor(() => expect(container.querySelector('[data-hl-id="bodhi"]')).not.toBeNull());
    }
    const pane = container.querySelector<HTMLElement>('.sc')!;
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === pane) return new DOMRect(0, 0, 600, 600);
      if (this.dataset.hlId === 'sujato') return new DOMRect(0, 1000 - pane.scrollTop, 400, 20);
      return getRect.call(this);
    });
    pane.scrollTop = 120;
    fireEvent.keyDown(window, { key: 'h' });
    fireEvent.click(screen.getByRole('button', { name: /Other translations/ }));
    const section = screen.getByRole('region', { name: 'Sujato highlights' });
    fireEvent.click(await within(section).findByRole('button', { name: `sujato English for ${id}` }));
    await waitFor(() => expect(container.querySelector('[data-hl-id="sujato"]')).not.toBeNull());
    expect(router.state.location.search).toBe('');
    expect(router.state.historyAction).toBe(mode === 'consulted' ? 'POP' : 'REPLACE');
    if (mode === 'consulted') expect(router.state.location.key).toBe(originalKey);
    expect(pane.scrollTop).toBe(710);
  });

  it('keeps the existing panel layout with only current highlights and jumps without a history step', async () => {
    const id = 'mn40';
    translations([id]);
    vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, highlights: { [id]: translationHighlights(id).filter((h) => h.by === 'thanissaro') } });
    const { container, router } = renderReader(`/read/${id}?by=thanissaro`);
    await waitFor(() => expect(container.querySelector('[data-hl-id="thanissaro"]')).not.toBeNull());
    const originalKey = router.state.location.key;
    const pane = container.querySelector<HTMLElement>('.sc')!;
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === pane) return new DOMRect(0, 0, 600, 600);
      if (this.dataset.hlId === 'thanissaro') return new DOMRect(0, 1000 - pane.scrollTop, 400, 20);
      return getRect.call(this);
    });
    fireEvent.keyDown(window, { key: 'h' });
    const panel = container.querySelector('[data-component="ReaderMenuPanel"]') as HTMLElement;
    expect(within(panel).queryAllByRole('region')).toHaveLength(0);
    expect(within(panel).getAllByRole('button', { name: 'Remove highlight' })).toHaveLength(1);
    fireEvent.click(await within(panel).findByRole('button', { name: `thanissaro English for ${id}` }));
    await waitFor(() => expect(pane.scrollTop).toBe(710));
    expect(router.state.location.key).toBe(originalKey);
    expect(container.querySelector('[data-component="ReaderMenuPanel"]')).toBeNull();
  });

  it.each([['Next', 'mn4'], ['Previous', 'mn2']])('opens %s in Sujato from an alternate', async (label, target) => {
    translations(['mn2', 'mn3', 'mn4']);
    const { router } = renderReader('/read/mn3?by=thanissaro');
    await screen.findByText('thanissaro English for mn3');
    expect(screen.getByRole('link', { name: 'Ṭhānissaro Bhikkhu' })).toHaveAttribute('href', 'https://www.dhammatalks.org/suttas/mn3.html');
    fireEvent.click(screen.getByText(label, { exact: true }));
    expect(router.state.location.pathname).toBe(`/read/${target}`);
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText(`sujato English for ${target}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bhikkhu Sujato (edited)' })).toBeTruthy();
  });

  it('changes translations within a sutta without borrowing Pali, notes or highlights', async () => {
    translations(['mn5']);
    vi.mocked(useReaderPrefs).mockReturnValue({ ...useReaderPrefs(), showSegmentNumbers: true });
    const { container, router } = renderReader('/read/mn5?by=thanissaro&at=2.7');
    fireEvent.click(await screen.findByText('thanissaro English for mn5'));
    fireEvent.click(container.querySelector('[data-seg] sup')!);
    fireEvent.click(screen.getByText('2.7'));
    expect(new URLSearchParams(router.state.location.search).get('by')).toBe('thanissaro');
    await act(() => router.navigate('/read/mn5?by=bodhi&at=2.7'));
    expect(await screen.findByText('bodhi English for mn5')).toBeTruthy();
    expect(container.querySelector('[data-reveal="pali"]')).toBeNull();
    expect(container.querySelector('[data-reveal="note"]')).toBeNull();
    await act(() => router.navigate('/read/mn5'));
    expect(await screen.findByText('sujato English for mn5')).toBeTruthy();
  });

  it.each(['unknown', 'bodhi'])('uses Sujato when the requested translator %s is unavailable', async (by) => {
    const id = by === 'unknown' ? 'mn6' : 'mn7';
    const corpus = translations([id]);
    delete corpus.suttas[id].by;
    renderReader(`/read/${id}?by=${by}&at=2.7`);
    expect(await screen.findByText(`sujato English for ${id}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bhikkhu Sujato (edited)' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalledWith(`/data/text/${by}/${id}.json`);
  });


  it('follows text references in their translation, uses Sujato for fallback links, and returns with Back', async () => {
    translations(['mn8', 'mn9', 'mn10']);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = url.split('/').pop()!.replace('.json', '');
      const by = url.includes('/bodhi/') ? 'bodhi' : 'sujato';
      return { ok: true, json: async () => [{
        key: `${id}:1.1`, pali: `${by} Pali`, en: 'His heading Compare MN 9 and MN 10.',
        headings: [[0, 11]], links: [[20, 24, '/read/mn9?by=bodhi&at=1.1'], [29, 34, '/read/mn10?at=1.1']],
      }] };
    }));
    const { container, router } = renderReader('/read/mn8?by=bodhi');
    await screen.findByRole('link', { name: 'MN 9' });
    expect(screen.getByRole('button', { name: 'His heading' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'MN 9' }));
    await waitFor(() => expect(container.querySelector('[data-seg]')?.parentElement?.id).toBe('mn9:1.1'));
    expect(router.state.location.pathname).toBe('/read/mn9');
    expect(new URLSearchParams(router.state.location.search).get('by')).toBe('bodhi');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(container.querySelector('[data-seg]')?.parentElement?.id).toBe('mn8:1.1'));
    fireEvent.click(screen.getByRole('link', { name: 'MN 10' }));
    await screen.findByRole('link', { name: 'Bhikkhu Sujato (edited)' });
    expect(router.state.location.pathname).toBe('/read/mn10');
    expect(new URLSearchParams(router.state.location.search).get('by')).toBeNull();
  });

  it('resolves an inner sutta in an alternate batched document and retains it in numbered addresses', async () => {
    translations(['dhp1-20']);
    vi.mocked(useReaderPrefs).mockReturnValue({ ...useReaderPrefs(), showSegmentNumbers: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [
      { key: 'dhp1:1', pali: 'First Pali', en: 'First verse', role: 'verse' },
      { key: 'dhp2:1', pali: 'Second Pali', en: 'Second verse', role: 'verse' },
    ] })));
    const { container, router } = renderReader('/read/DHP2?by=thanissaro&at=1');
    await screen.findByText('Second verse');
    expect(fetch).toHaveBeenCalledWith('/data/text/thanissaro/dhp1-20.json');
    expect(container.querySelector('[data-wash-block] [data-seg]')?.parentElement?.id).toBe('dhp2:1');
    fireEvent.click(within(container.querySelector('[id="dhp2:1"]')!).getByText('1'));
    expect(router.state.location.pathname).toBe('/read/dhp2');
    expect(new URLSearchParams(router.state.location.search).get('by')).toBe('thanissaro');
  });

});
