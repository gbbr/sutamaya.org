import { test, expect, selectWithinSegment } from './fixtures';

// Moving around the reader: Prev/Next at the foot of the text, the same by keyboard, the
// breadcrumb back into the tree, and closing.

test('@smoke Prev/Next step through the collection', async ({ page }) => {
  await page.goto('/browse/dn-silakkhandhavagga');
  await page.locator('[data-component="ListPane"]').getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/read\/dn2/);
  // The step animates the outgoing sutta out, so both titles are briefly in the DOM.
  await expect(page.getByRole('heading', { name: 'The Fruits of the Ascetic Life' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
});

test('@smoke the breadcrumb goes back to the sutta list it belongs to', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Entire Spectrum of Ethics' }).click();
  await expect(page).toHaveURL(/\/browse\/dn-silakkhandhavagga/);
  await expect(page.locator('[data-component="ListPane"]')).toContainText('The Divine Net');
});

test('closing the reader returns to where it was opened from, not the sutta’s place in the canon', async ({
  page,
}) => {
  // A highlight puts dn1 into the synthesized Highlights list, giving a second, quite different
  // route to the same sutta — which is what makes "where you came from" testable at all.
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await selectWithinSegment(page, 1, 3, 16);
  await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();
  await expect(page.locator('[data-seg="1"] [data-hl-id]')).toBeVisible();

  await page.goto('/browse');
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await page.locator('[data-component="ListsTreeView"]').getByRole('button', { name: /Highlights/ }).click();

  const listPane = page.locator('[data-component="ListPane"]');
  await expect(listPane).toContainText('The Divine Net');
  await listPane.getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
  // The reader binds its key handling on mount, so wait for the text before pressing anything.
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.keyboard.press('Escape');
  // Back to the Highlights list, not to dn1's vagga in the corpus tree.
  await expect(page).toHaveURL(/auto-highlights/);
});
