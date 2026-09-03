import { test, expect, searchResults } from './fixtures';

// Search is how a reader who knows what they want gets there without walking the tree. It matches
// ref, title, Pali, blurb, note and list names — not sutta text — and the UI says so.

test('@smoke a search finds a sutta by its English title and opens it', async ({ page }) => {
  await page.goto('/browse');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const box = page.getByPlaceholder('Search suttas and lists');
  await box.fill('Divine Net');

  const hits = searchResults(page);
  await expect(hits.getByRole('button', { name: /The Divine Net/ })).toBeVisible();

  await hits.getByRole('button', { name: /The Divine Net/ }).first().click();
  await expect(page).toHaveURL(/\/read\/dn1/);
});

test('@smoke a query with no matches says what search does not cover', async ({ page }) => {
  await page.goto('/browse');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  // A phrase that is in the sutta text but in no title, ref, blurb or list name — the exact case
  // the scope note exists to explain.
  await page.getByPlaceholder('Search suttas and lists').fill('zzzznotasutta');

  await expect(page.locator('[data-component="ListPane"]')).toContainText('not the text of the suttas');
});
