import { test, expect } from './fixtures';

// Tapping a segment reveals its Pali; tapping a word in that Pali opens the dock with a gloss.
// The gloss comes from a range shard fetched on demand, so this is also the one journey that
// proves the shard index and the reader's tokenizer still agree in the browser.

test('@smoke tapping a Pali word opens the dictionary dock', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

  // Pali is revealed per segment by tapping the English.
  await page.locator('[data-seg="1"]').click();
  const words = page.locator('[data-word-seg="1"]');
  await expect(words.first()).toBeVisible();

  await words.first().click();
  const dock = page.locator('[data-component="DictionaryDock"]');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('evaṁ');
  // A headword with no gloss renders bare, so an empty dock would still be "visible" — assert
  // there is actually a definition in it.
  await expect(dock).toContainText(/\w{3,}/);

  // The dock steps word by word without going back to the text.
  await dock.getByRole('button', { name: 'Next word' }).click();
  await expect(dock).toContainText('me');

  await page.keyboard.press('Escape');
  await expect(dock).toHaveCount(0);
});
