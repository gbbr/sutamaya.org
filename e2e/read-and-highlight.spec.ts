import { test, expect, selectWithinSegment, segmentText, waitForLocalWrites } from './fixtures';

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
