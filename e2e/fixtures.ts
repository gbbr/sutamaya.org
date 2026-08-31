import { test as base, expect, type Page } from '@playwright/test';

// Noise that is expected and says nothing about the app's health. Keep this list short and
// specific — every entry is a class of error the suite stops being able to see.
const IGNORED_CONSOLE = [
  // Vite's dev-mode websocket, and the service worker that is off by default in dev.
  /\[vite\] connect/i,
  /ServiceWorker|serviceWorker registration/i,
  // Signed out is the normal state for most specs; the mirror flush reports it and carries on.
  /\b401\b/,
  /Failed to load resource: the server responded with a status of 401/i,
];

// A request the app is expected to make and the server is expected to refuse: a signed-out
// reader's data sync. Anything else in the 4xx/5xx range is a real finding.
function isExpectedFailure(url: string, status: number): boolean {
  if (status === 401 && url.includes('/api/')) return true;
  return false;
}

export interface PageErrors {
  console: string[];
  page: string[];
  network: string[];
  /**
   * Latched by `setOffline` below. Cutting the network makes requests fail by definition — the
   * service worker's background revalidation, a sync attempt, anything in flight — and the
   * browser logs each one. Those say nothing about the app, so a test that has been offline stops
   * counting them. Uncaught exceptions and the app's own console.error still fail it.
   */
  allowNetworkFailures: boolean;
  /** All of the above, as one list — what assertions read. */
  all(): string[];
}

// Each test gets its own client IP, because the Worker's rate limiter buckets by
// `cf-connecting-ip` and `GET /api/auth/me` — fired on every page load and reload — is metered at
// 20 a minute (wrangler.jsonc). A suite of a dozen journeys blows one shared budget within
// seconds, and every test after that fails on a 429 that says nothing about the app. Per test,
// the limiter stays live inside a test while no longer leaking between them.
//
// Local dev only, in effect: Cloudflare's edge sets this header itself, so a run against a
// deployment is rate-limited for real, which is the correct behaviour there.
let ipCounter = 0;
function nextClientIp(): string {
  const n = ++ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export const test = base.extend<{ errors: PageErrors }>({
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'cf-connecting-ip': nextClientIp() });
  },

  // Attached before the test body runs, asserted empty after it. This is the only genuinely
  // exploratory part of the suite: it fails a test for problems nobody thought to assert.
  //
  // Watches the default `page` only. A spec that opens further contexts to stand in for other
  // devices gets no error collection on those, which is accepted: what those pages are there to
  // prove is asserted directly.
  errors: [
    async ({ page }, use) => {
      const errors: PageErrors = {
        console: [],
        page: [],
        network: [],
        allowNetworkFailures: false,
        all() {
          return [...this.console, ...this.page, ...this.network];
        },
      };

      // Cloudflare's RUM beacon (web/index.html) is in the page on every origin, and its CORS
      // preflight can't succeed from a test origin. Stubbed out rather than ignored: real traffic
      // analytics shouldn't be counting test runs either. Fulfilled empty rather than aborted,
      // since an aborted request is itself a console error.
      // The JS content type is for the beacon script itself; a module script served as anything
      // else is a console error of its own.
      await page.route(/cloudflareinsights\.com/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
      );

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
        if (errors.allowNetworkFailures && /net::ERR_|Failed to fetch|Load failed/i.test(text)) return;
        errors.console.push(`console.error: ${text}`);
      });

      page.on('pageerror', (err) => {
        errors.page.push(`uncaught: ${err.message}`);
      });

      page.on('response', (res) => {
        const status = res.status();
        if (status < 400) return;
        const url = res.url();
        if (isExpectedFailure(url, status)) return;
        errors.network.push(`HTTP ${status} ${url}`);
      });

      await use(errors);

      expect(errors.all(), 'page reported errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Waits until the local mirror has stopped changing on disk.
 *
 * User data is written to IndexedDB asynchronously, a little after the UI has already moved: a
 * reload issued immediately after an edit can beat that write and read back the state before it.
 * That is not something a person can hit by hand, but a test reloads within a millisecond of
 * clicking, so anything asserting "and it survives a reload" has to wait for the write first —
 * otherwise it is asserting how fast IndexedDB happens to be.
 *
 * Settled means two identical reads in a row, rather than a fixed sleep, so it costs one poll
 * interval when the write has already landed.
 */
export async function waitForLocalWrites(page: Page) {
  const read = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open('sutamaya');
          open.onerror = () => resolve('unavailable');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('mirrors')) return resolve('empty');
            const all = db.transaction('mirrors', 'readonly').objectStore('mirrors').getAll();
            all.onerror = () => resolve('unreadable');
            all.onsuccess = () => resolve(JSON.stringify(all.result));
          };
        })
    );

  let previous = await read();
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(100);
    const current = await read();
    if (current === previous) return;
    previous = current;
  }
  throw new Error('the local mirror never stopped changing');
}

/**
 * Cuts (or restores) this page's network, and tells the error fixture to stop counting failed
 * requests for the rest of the test — see `allowNetworkFailures`. Always use this rather than
 * `page.context().setOffline` directly, or the failures the cut itself causes fail the test.
 */
export async function setOffline(page: Page, errors: PageErrors, offline: boolean) {
  if (offline) errors.allowNetworkFailures = true;
  await page.context().setOffline(offline);
}

/**
 * Whether this page is narrower than LayoutContext's MOBILE_BREAKPOINT (860), where the library
 * shows one pane at a time instead of two. The number is duplicated rather than imported: pulling
 * it from web/src would drag React into the test process for one integer.
 */
function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 860;
}

/**
 * Opens a leaf group's sutta list, and returns the pane holding it.
 *
 * On mobile the addressed node is shown highlighted in the tree rather than opened — LibraryPage
 * restores the last pane from localStorage and a test profile has none, so it starts on the tree.
 * Tapping the row is what reveals its suttas, which is the step a reader takes too.
 */
export async function openSuttaList(page: Page, nodeId: string) {
  await page.goto(`/browse/${nodeId}`);
  if (isMobile(page)) await page.locator(`[data-node-id="${nodeId}"]`).click();
  const listPane = page.locator('[data-component="ListPane"]');
  await expect(listPane).toBeVisible();
  return listPane;
}

/**
 * Switches the library to its "Lists" tab.
 *
 * The Library/Lists toggle sits in the tree pane's header, so on mobile — showing the sutta list,
 * and so not the tree — the list has to be backed out of first. Unconditional rather than
 * "click Back if it's there": every caller is on the list pane at this point, and a missing Back
 * button should fail rather than be shrugged off.
 */
export async function openListsTab(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
}

/** The pane a library search puts its hits in: the list pane on desktop, the tree pane on mobile. */
export function searchResults(page: Page) {
  return page.locator(isMobile(page) ? '[data-component="TreePane"]' : '[data-component="ListPane"]');
}

/** The reader's rendered text size, in px — how a typography preference is observed from outside. */
export const readerFontSize = (page: Page) =>
  page.locator('[data-seg="1"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** The reader's paper colour — how the theme is observed from outside. */
export const readerBackground = (page: Page) =>
  page.locator('[data-component="ReaderPage"]').evaluate((el) => getComputedStyle(el).backgroundColor);

/**
 * Writes a note on the sutta the reader is showing, and waits for it to reach the local mirror.
 * Opened with the keyboard, committed with Cmd/Ctrl+Return — the same path the shortcut documents.
 */
export async function writeNote(page: Page, text: string) {
  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Something to remember this by');
  await note.fill(text);
  await note.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText(text);
  await page.keyboard.press('Escape');
  await waitForLocalWrites(page);
}

/** One end of a selection: a character offset into the stored text of one segment. */
interface SelectionPoint {
  seg: number;
  offset: number;
}

/**
 * Select a character range and end the gesture the way a real drag does, so the highlight popup
 * opens. The two ends may sit in different segments.
 *
 * The reader derives highlight offsets from the DOM selection (`useHighlightPopup`), so this
 * drives the same Selection API the browser would — building the range from the text nodes the
 * segments actually rendered, rather than from `seg.en`, keeps it honest about what is on screen.
 */
async function selectRange(page: Page, start: SelectionPoint, end: SelectionPoint) {
  // The popup anchors to the selection's screen rect, so a selection made off-screen opens it
  // off-screen — which is not a state a real drag can produce.
  await page.locator(`[data-seg="${start.seg}"]`).scrollIntoViewIfNeeded();

  await page.evaluate(
    ({ start, end }) => {
      const locate = (segIndex: number, offset: number): [Node, number] => {
        const seg = document.querySelector(`[data-seg="${segIndex}"]`);
        if (!seg) throw new Error(`no segment ${segIndex} on the page`);

        // Walk the segment's text nodes, skipping the ones marked as not part of the stored text
        // (the list-item marker and the note asterisk), so offsets line up with what gets stored.
        const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            (node.parentElement as HTMLElement | null)?.closest('[data-seg-ignore]')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });

        let seen = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const len = node.textContent?.length ?? 0;
          if (seen + len >= offset) return [node, offset - seen];
          seen += len;
        }
        throw new Error(`offset ${offset} is past the end of segment ${segIndex}`);
      };

      const range = document.createRange();
      range.setStart(...locate(start.seg, start.offset));
      range.setEnd(...locate(end.seg, end.offset));

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    { start, end }
  );

  // The popup opens on the gesture ending, not on the selection changing.
  await page.locator('[data-segroot]').dispatchEvent('mouseup');
}

/** A selection inside one segment, by character offsets into that segment's stored text. */
export async function selectWithinSegment(page: Page, segIndex: number, start: number, end: number) {
  await selectRange(page, { seg: segIndex, offset: start }, { seg: segIndex, offset: end });
}

/**
 * A selection running from one segment into a later one — the gesture that produces a highlight
 * whose two stored endpoints sit in different segments.
 */
export async function selectAcrossSegments(
  page: Page,
  startSeg: number,
  startOffset: number,
  endSeg: number,
  endOffset: number
) {
  await selectRange(page, { seg: startSeg, offset: startOffset }, { seg: endSeg, offset: endOffset });
}

/** Text of the segment as the reader rendered it, minus the bits that aren't part of `seg.en`. */
export async function segmentText(page: Page, segIndex: number): Promise<string> {
  return page.evaluate((i) => {
    const seg = document.querySelector(`[data-seg="${i}"]`);
    if (!seg) throw new Error(`no segment ${i} on the page`);
    const clone = seg.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-seg-ignore]').forEach((el) => el.remove());
    return clone.textContent ?? '';
  }, segIndex);
}
