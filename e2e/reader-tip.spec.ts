import { test, expect, type Page } from './fixtures';

// The first-run tip waits for the reader to scroll into a sutta's text, ticks its first step once a
// line's Pali shows, and retires for good on the first lookup or when closed. Only a browser can
// answer the first part: the wait is decided by where the text sits on screen.

async function scrollIntoText(page: Page) {
  await page.locator('[data-seg="1"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

const tipProgress = (page: Page) => page.evaluate(() => localStorage.getItem('sutamaya.readerTip'));

test('the first-run tip waits for the text, ticks off the Pali, and retires on a lookup', async ({ page }) => {
  await page.goto('/read/dn1');
  const tip = page.locator('[data-component="ReaderTip"]');
  const firstStep = tip.locator('li').first();
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
  await expect(tip).toHaveCount(0);

  await scrollIntoText(page);
  await expect(tip).toContainText('Study the Pali');
  await expect(firstStep).not.toContainText('Done');

  await page.locator('[data-seg="1"]').click();
  await expect(firstStep).toContainText('Done');

  await page.locator('[data-word-seg="1"]').first().click();
  await expect(page.locator('[data-component="DictionaryDock"]')).toBeVisible();
  await expect(tip).toHaveCount(0);
  expect(await tipProgress(page)).toContain('"done":true');
});

test('closing the first-run tip retires it for good', async ({ page }) => {
  await page.goto('/read/dn1');
  const tip = page.locator('[data-component="ReaderTip"]');
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
  await scrollIntoText(page);
  await tip.getByRole('button', { name: 'Close' }).click();
  await expect(tip).toHaveCount(0);
  expect(await tipProgress(page)).toContain('"done":true');
});
