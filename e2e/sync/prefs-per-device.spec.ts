import { test, expect, readerBackground, readerFontSize, writeNote } from '../fixtures';
import { signIn } from '../session';

// Theme, text size and the rest are per-device preferences held in localStorage, deliberately kept
// out of the synced account data: a phone read at night and a desktop read at noon want different
// settings, and syncing them makes one device fight the other.
//
// The guard has to be end-to-end. Nothing in the client can prove a preference *doesn't* reach the
// account — only a second device signed into the same account, still on its own defaults, can.

test('display preferences stay on the device while user data syncs', async ({ page, browser }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  const defaultBackground = await readerBackground(page);
  const defaultSize = await readerFontSize(page);

  await page.keyboard.press('Shift+D');
  await expect.poll(() => readerBackground(page)).not.toBe(defaultBackground);

  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Increase text size' }).click();
  await page.getByRole('button', { name: 'Increase text size' }).click();
  await page.keyboard.press('Escape');
  expect(await readerFontSize(page)).toBeGreaterThan(defaultSize);

  // Something that *is* user data, changed in the same session. Without it, this test would also
  // pass if syncing were broken outright.
  await writeNote(page, 'user data, unlike the theme');

  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  await other.goto('/read/dn1');

  // The control: the account's data did travel.
  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('user data, unlike the theme', {
    timeout: 30_000,
  });

  // The preferences did not.
  expect(await readerBackground(other)).toBe(defaultBackground);
  expect(await readerFontSize(other)).toBe(defaultSize);

  await second.close();
});
