import { test, expect, type Page } from './fixtures';

// The reader's Display panel is where typography and theme live. Every one of these settings is
// a preference rather than user data, so it belongs to the device and has to survive a reload.

const fontSizeOf = (page: Page) =>
  page.locator('[data-seg="1"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

const readerBackground = (page: Page) =>
  page.locator('[data-component="ReaderPage"]').evaluate((el) => getComputedStyle(el).backgroundColor);

test('@smoke text size and line height change the text and stick', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  const before = await fontSizeOf(page);

  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Increase text size' }).click();
  await page.getByRole('button', { name: 'Increase text size' }).click();

  const bigger = await fontSizeOf(page);
  expect(bigger).toBeGreaterThan(before);

  // Line height is set as a ratio, so it moves the rendered line box without touching font size.
  const lineBefore = await page
    .locator('[data-seg="1"]')
    .evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  await page.getByRole('button', { name: 'Increase line height' }).click();
  await expect
    .poll(() => page.locator('[data-seg="1"]').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)))
    .toBeGreaterThan(lineBefore);

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await expect.poll(() => fontSizeOf(page)).toBe(bigger);
});

test('@smoke the theme switches and sticks', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  const before = await readerBackground(page);
  await page.keyboard.press('Shift+D');
  await expect.poll(() => readerBackground(page)).not.toBe(before);

  const after = await readerBackground(page);
  await page.reload();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await expect.poll(() => readerBackground(page)).toBe(after);
});

test('Pali can be shown on every segment instead of on tap', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // On tap: nothing is revealed until a segment is tapped. Scoped to a segment, since an
  // untranslated colophon renders its Pali words in place whatever this setting says.
  await expect(page.locator('[data-word-seg="1"]')).toHaveCount(0);

  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Always' }).click();
  await page.keyboard.press('Escape');

  await expect(page.locator('[data-word-seg="1"]').first()).toBeVisible();
  await expect(page.locator('[data-word-seg="2"]').first()).toBeVisible();
});

test('translator notes can be turned on and off', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // dn1's first segment carries a translator note, marked by an asterisk after the text — off by
  // default, since most reading doesn't want it.
  const marker = page.locator('[data-seg="1"] [data-seg-ignore]');
  await expect(marker).toHaveCount(0);

  await page.keyboard.press('c');
  await expect(marker).toHaveCount(1);

  // The marker is not part of the segment's stored text, so turning notes on must not shift the
  // offsets a highlight would be stored at.
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.*');

  await page.keyboard.press('c');
  await expect(marker).toHaveCount(0);
});
