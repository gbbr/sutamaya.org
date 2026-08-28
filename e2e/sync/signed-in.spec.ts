import { test, expect } from '../fixtures';
import { signIn } from '../session';

// Signed in, edits leave the device: the mirror flushes them to the Worker, and another device
// signed into the same account picks them up on its next read. Two browser contexts stand in for
// the two devices — separate IndexedDB, separate device id, one account.
//
// Each test gets an account of its own from the pool (see e2e/session.ts), so nothing has to be
// cleaned up between them and no test can see another one's data.

// Thin on purpose: it is the canary on the cookie-minting helper. When that breaks, this fails
// first and says so, instead of every signed-in spec failing on an assertion about something else.
test('the app knows it is signed in', async ({ page }) => {
  await signIn(page);
  await page.goto('/browse');

  await expect(page.getByRole('button', { name: /Signed in as/ })).toBeVisible();
});

test('a note written on one device reaches another', async ({ page, browser }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Add a note — return to save');
  await note.fill('written on the first device');
  await note.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written on the first device');

  // A second, independent device on the same account: its own mirror, so anything it shows had to
  // come back from the Worker.
  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  await other.goto('/read/dn1');

  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('written on the first device', {
    timeout: 20_000,
  });

  await second.close();
});
