import { test, expect, openListsTab, type Page } from '../fixtures';
import { signIn } from '../session';

// Syncs a device the way reconnecting does and returns the status its pull is answered with. The
// app skips a sync while one is already out, so the event is sent again until a pull goes. The
// status is Playwright's view of the response, which under WebKit reads 200 for a 304 the page
// itself receives as a 304; the sync specs run on Chromium.
async function syncNow(page: Page): Promise<number> {
  const pulled = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/data');
  const nudge = setInterval(() => void page.evaluate(() => window.dispatchEvent(new Event('online'))).catch(() => {}), 250);
  try {
    return (await pulled).status();
  } finally {
    clearInterval(nudge);
  }
}

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
  const note = page.getByPlaceholder('Something to remember this by');
  await note.fill('written on the first device');
  await note.press('ControlOrMeta+Enter');
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

// A device with nothing to send hands back the tag of the data it holds, and the Worker answers
// "not modified" until another device writes (docs/offline-sync.md's "The flush").
test('a device with nothing to send is answered "not modified" until another device writes', async ({ page, browser }) => {
  const account = await signIn(page);

  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  // The library records nothing, so every sync from here on has nothing to send.
  const launched = other.waitForResponse((res) => new URL(res.url()).pathname === '/api/data');
  await other.goto('/browse');
  expect((await launched).status()).toBe(200);
  expect(await syncNow(other)).toBe(304);

  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  const landed = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/data/push' && !!res.request().postData()?.includes('written on the first device')
  );
  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Something to remember this by');
  await note.fill('written on the first device');
  await note.press('ControlOrMeta+Enter');
  expect((await landed).ok()).toBe(true);

  expect(await syncNow(other)).toBe(200);
  // Shown from that pull alone: nothing the second device does from here syncs.
  await openListsTab(other);
  await other.getByRole('button', { name: /Notes/ }).click();
  await expect(other.locator('[data-component="ListPane"]')).toContainText('The Divine Net');

  await second.close();
});
