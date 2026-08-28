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

  // A selection crossing a paragraph boundary is stored as one row per segment sharing a group id
  // (buildCrossSegmentRanges), and the rows are only ever assembled back into one highlight at
  // read time. Nothing but a real browser produces that selection: it is a DOM Range spanning two
  // elements, which is what the unit tests have to supply by hand.
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

    // One highlight, not two that happen to abut. A row's id is `${group}:${segment}`
    // (lib/mirrorView.ts), so the group is what the two share.
    const group = async (span: typeof head) => ((await span.getAttribute('data-hl-id')) ?? '').split(':')[0];
    expect(await group(head)).toBe(await group(tail));
    expect(await group(head)).not.toBe('');

    await waitForLocalWrites(page);
    await page.reload();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(first.slice(3));
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveText(second.slice(0, 11));

    // Removing it from either end takes the whole group, not just the row that was clicked.
    await page.locator('[data-seg="2"] [data-hl-id]').click();
    await page.locator('[data-component="HighlightPopup"]').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveCount(0);
    await expect(page.locator('[data-seg="2"] [data-hl-id]')).toHaveCount(0);
  });

  // Three segments, so one of them is swallowed whole — the branch buildCrossSegmentRanges takes
  // for a middle segment, which its unit tests cover as arithmetic but nothing drives through a
  // real selection.
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
    const groups = await page
      .locator('[data-seg] [data-hl-id]')
      .evaluateAll((els) => [...new Set(els.map((el) => (el.getAttribute('data-hl-id') ?? '').split(':')[0]))]);
    expect(groups).toHaveLength(1);
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
});
