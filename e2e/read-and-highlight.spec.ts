import {
  test,
  expect,
  selectAcrossSegments,
  selectWithinSegment,
  segmentText,
  waitForLocalWrites,
} from './fixtures';

// The first journey: a reader arriving with nothing, finding a sutta by browsing, highlighting a
// phrase, and finding it still there after a reload. Signed out throughout — which is a supported
// state, not a degraded one (see CLAUDE.md, "Signing in is never required"), and what makes the
// @smoke half of this safe to run against a deployment: a signed-out reader's writes go to their
// own local mirror and never reach anyone's account.

test.describe('browse and read', () => {
  test('@smoke a first visit browses the canon and opens a sutta', async ({ page }) => {
    await page.goto('/browse');

    // Nothing selected: the five nikāyas, collapsed, and a list pane with no collection chosen.
    await expect(page.locator('[data-component="TreePane"]')).toContainText('Dīgha Nikāya');
    await expect(page.locator('[data-component="ListPane"]')).toContainText('Choose a collection to begin');

    // A nikaya expands in place rather than navigating — only leaf groups are addressable.
    await page.locator('[data-node-id="dn"]').click();
    await expect(page.locator('[data-node-id="dn-silakkhandhavagga"]')).toBeVisible();
    expect(page.url()).toContain('/browse');
    expect(page.url()).not.toContain('/browse/dn/');

    await page.locator('[data-node-id="dn-silakkhandhavagga"]').click();
    await expect(page).toHaveURL(/\/browse\/dn-silakkhandhavagga/);

    const listPane = page.locator('[data-component="ListPane"]');
    await expect(listPane).toContainText('The Divine Net');

    await listPane.getByRole('button', { name: /The Divine Net/ }).click();
    await expect(page).toHaveURL(/\/read\/dn1/);

    // The reader has actually rendered the text, not just the shell.
    await expect(page.locator('[data-component="SegmentedText"]')).toBeVisible();
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
  });
});

test.describe('highlighting', () => {
  test('a highlight survives a reload', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    // "I have heard." — offsets into the segment's stored English, which is what gets persisted.
    const phrase = (await segmentText(page, 1)).slice(3, 16);
    expect(phrase).toBe('I have heard.');

    await selectWithinSegment(page, 1, 3, 16);

    const popup = page.locator('[data-component="HighlightPopup"]');
    await expect(popup).toBeVisible();

    // The colour swatches carry no accessible name, so they are addressed by position.
    await popup.locator('button').first().click();

    const highlight = page.locator('[data-seg="1"] [data-hl-id]');
    await expect(highlight).toHaveText(phrase);

    // The local mirror is the durable write; a reload must find it there with no network involved.
    await waitForLocalWrites(page);
    await page.reload();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(phrase);
  });

  // A selection crossing a paragraph boundary is stored as its two endpoints, and resolved back
  // into per-segment spans against the text at read time. Nothing but a real browser produces that
  // selection: it is a DOM Range spanning two elements, which is what the unit tests have to
  // supply by hand.
  test('a highlight can run from one segment into the next', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    const first = await segmentText(page, 1);
    const second = await segmentText(page, 2);

    // From "I have heard." to the end of "At one time" in the paragraph below it.
    await selectAcrossSegments(page, 1, 3, 2, 11);

    await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();

    const head = page.locator('[data-seg="1"] [data-hl-id]');
    const tail = page.locator('[data-seg="2"] [data-hl-id]');

    // The first segment keeps everything from the selection start to its own end; the second gets
    // its head. Neither is the whole segment.
    await expect(head).toHaveText(first.slice(3));
    await expect(tail).toHaveText(second.slice(0, 11));

    // One highlight, not two that happen to abut: both painted spans carry the same highlight id.
    const id = async (span: typeof head) => (await span.getAttribute('data-hl-id')) ?? '';
    expect(await id(head)).toBe(await id(tail));
    expect(await id(head)).not.toBe('');

    await waitForLocalWrites(page);
    await page.reload();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(first.slice(3));
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveText(second.slice(0, 11));

    // Removing it from either end takes the whole highlight, not just the part that was clicked.
    await page.locator('[data-seg="2"] [data-hl-id]').click();
    await page.locator('[data-component="HighlightPopup"]').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveCount(0);
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveCount(0);
  });

  // Three segments, so one of them is swallowed whole — the middle of a span, which carries no
  // stored offsets of its own and is painted from whatever that segment currently says.
  test('a highlight spanning three segments paints the middle one whole', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    const middle = await segmentText(page, 2);
    await selectAcrossSegments(page, 1, 3, 3, 10);
    await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();

    // The middle segment has no free end: all of it is inside the selection.
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveText(middle);
    await expect(page.locator('[data-seg="3"] [data-hl-id]')).toHaveText((await segmentText(page, 3)).slice(0, 10));

    // Still one highlight across all three.
    const ids = await page
      .locator('[data-seg] [data-hl-id]')
      .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-hl-id') ?? ''))]);
    expect(ids).toHaveLength(1);
  });

  // The middle of a three-segment highlight is the part with no stored offsets of its own — it is
  // painted from the segment's current text, and a click on it has only the highlight's id to go on.
  // Acting there has to reach the whole highlight, not the segment that was clicked.
  test('the middle segment of a highlight can be recoloured and removed like any other part', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    const first = await segmentText(page, 1);
    const middle = await segmentText(page, 2);
    const last = await segmentText(page, 3);

    await selectAcrossSegments(page, 1, 3, 3, 10);
    const popup = page.locator('[data-component="HighlightPopup"]');
    await popup.locator('button').first().click();

    const spans = [1, 2, 3].map((i) => page.locator(`[data-seg="${i}"] [data-hl-id]`));
    const colourOf = (i: number) => spans[i].evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(spans[1]).toHaveText(middle);
    const before = await colourOf(1);

    // Recolour from the middle: a recolour is a tombstone plus a brand new highlight, so every
    // segment has to come back under the new colour rather than the ends keeping the old one.
    await spans[1].click();
    await expect(popup).toBeVisible();
    await popup.locator('button').nth(1).click();

    await expect.poll(() => colourOf(1)).not.toBe(before);
    const recoloured = await colourOf(1);
    expect(await colourOf(0)).toBe(recoloured);
    expect(await colourOf(2)).toBe(recoloured);

    // Still one highlight covering the same text, under a new id — not three fragments.
    await expect(spans[0]).toHaveText(first.slice(3));
    await expect(spans[1]).toHaveText(middle);
    await expect(spans[2]).toHaveText(last.slice(0, 10));
    const ids = await page
      .locator('[data-seg] [data-hl-id]')
      .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-hl-id') ?? ''))]);
    expect(ids).toHaveLength(1);

    // And it survives the round trip through storage before being erased from the middle again.
    await waitForLocalWrites(page);
    await page.reload();
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveText(middle);

    await page.locator('[data-seg="2"] [data-hl-id]').click();
    await popup.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-seg] [data-hl-id]')).toHaveCount(0);
  });

  test('an existing highlight can be recoloured and removed', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    await selectWithinSegment(page, 1, 3, 16);
    const popup = page.locator('[data-component="HighlightPopup"]');
    await popup.locator('button').first().click();

    const highlight = page.locator('[data-seg="1"] [data-hl-id]');
    await expect(highlight).toBeVisible();
    const firstColour = await highlight.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Clicking an existing highlight acts on it, rather than starting a new selection.
    await highlight.click();
    await expect(popup).toBeVisible();
    await popup.locator('button').nth(1).click();

    // A recolour is a new group over the same range, so the span persists with a different fill.
    await expect(highlight).toBeVisible();
    await expect
      .poll(() => highlight.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(firstColour);

    await highlight.click();
    await popup.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveCount(0);

    // Removal is a tombstone, not a row deletion — it must not come back on the next read.
    await waitForLocalWrites(page);
    await page.reload();
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveCount(0);
  });

  // A highlight used to be stored as one range per segment it covered, each interior range holding
  // that segment's length at the time of highlighting. `upgradeStoredMirror` collapses those to the
  // span's two endpoints as the mirror comes out of IndexedDB (lib/mirrorDb.ts).
  //
  // This is the one path that runs exactly once per device and can never be re-run, and for a
  // reader who has never signed in there is no server copy to fall back on — so it is checked
  // against a real mirror in real browser storage rather than only as a state transition.
  test('a highlight persisted in the old per-segment shape is collapsed on load', async ({ page }) => {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    const first = await segmentText(page, 1);
    const middle = await segmentText(page, 2);
    const last = await segmentText(page, 3);
    // Wait for the app's own first write, so the record put below isn't overwritten by it.
    await waitForLocalWrites(page);

    // The middle range's stored end is deliberately short of the segment's current length — the
    // state upstream rewording a segment longer used to leave behind, and the gap this whole change
    // exists to close.
    const staleMiddleEnd = middle.length - 12;
    expect(staleMiddleEnd).toBeGreaterThan(0);

    const written = await page.evaluate(
      ({ firstLen, staleMiddleEnd }) =>
        new Promise<string>((resolve, reject) => {
          const userId = localStorage.getItem('sutamaya.localUserId');
          if (!userId) return reject(new Error('no local user id yet'));
          const open = indexedDB.open('sutamaya');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const put = open.result
              .transaction('mirrors', 'readwrite')
              .objectStore('mirrors')
              .put({
                userId,
                lists: {},
                notes: {},
                visited: {},
                ops: [],
                nextSeq: 1,
                highlights: {
                  'legacy-highlight': {
                    dirty: false,
                    data: {
                      g: 'legacy-highlight',
                      suttaId: 'dn1',
                      // The shape the previous build persisted: no `span`, one entry per segment.
                      ranges: [
                        { i: 1, s: 3, e: firstLen },
                        { i: 2, s: 0, e: staleMiddleEnd },
                        { i: 3, s: 0, e: 10 },
                      ],
                      color: '#F0E3A8',
                      erase: [],
                      mtime: '2026-01-01T00:00:00.000Z|old-device',
                      sent: true,
                    },
                  },
                },
              });
            put.onerror = () => reject(put.error);
            put.onsuccess = () => resolve(userId);
          };
        }),
      { firstLen: first.length, staleMiddleEnd }
    );
    expect(written).toContain('local-');

    await page.reload();
    await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

    // Both ends are where the reader put them, and the middle segment is painted in full rather
    // than stopping at the length recorded when the highlight was made.
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(first.slice(3));
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveText(middle);
    await expect(page.locator('[data-seg="3"] [data-hl-id]')).toHaveText(last.slice(0, 10));

    // One highlight, still under the id it was stored with — the collapse is not a re-creation, so
    // a device that had already synced this highlight doesn't push a duplicate under a new id.
    const ids = await page
      .locator('[data-seg] [data-hl-id]')
      .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-hl-id')))]);
    expect(ids).toEqual(['legacy-highlight']);

    // And it is written back in the current shape, so the collapse is paid for once rather than on
    // every load.
    await waitForLocalWrites(page);
    const stored = await page.evaluate(
      () =>
        new Promise<{ span?: unknown; ranges?: unknown }>((resolve, reject) => {
          const open = indexedDB.open('sutamaya');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction('mirrors', 'readonly').objectStore('mirrors').getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              const mirror = all.result.find((m) => m.highlights?.['legacy-highlight']);
              resolve(mirror?.highlights['legacy-highlight'].data ?? {});
            };
          };
        })
    );
    expect(stored.span).toEqual({ i0: 1, o0: 3, i1: 3, o1: 10 });
    expect(stored.ranges).toBeUndefined();
  });
});
