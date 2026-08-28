import { test, expect, writeNote } from '../fixtures';
import { signIn } from '../session';

// A session can end while the app is open and unaware: the cookie expires, or the account is signed
// out somewhere else. The app finds out only when its next request comes back 401 — and by then the
// reader may already have written something.
//
// The promise is the same one offline makes: the local write is the durable one, so nothing is lost
// while the flush has nowhere to go. This is the only place that is exercised against a real Worker
// actually refusing the request.

test('an edit made after the session has quietly ended is not lost', async ({ page, browser }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'written while the session was good');

  // The session ends elsewhere. Nothing tells the page: it still believes it is signed in, and
  // finds out on its next call. (The error fixture already tolerates 401s on /api/*.)
  await page.context().clearCookies();

  // Watched, not assumed: without a refused push this test would still pass while proving nothing,
  // because a note is on screen the moment it is typed.
  const refused: string[] = [];
  page.on('response', (res) => {
    if (res.status() === 401 && res.url().includes('/api/')) refused.push(res.url());
  });

  await writeNote(page, 'written after the session ended');
  await expect.poll(() => refused.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // The reader keeps working — the edit is on screen and in the local mirror, whatever the server
  // has to say about it.
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written after the session ended');
  await page.reload();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // Signing back in: the queued edit should now reach the account, and from there another device.
  await signIn(page, account);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written after the session ended', {
    timeout: 30_000,
  });

  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  await other.goto('/read/dn1');
  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('written after the session ended', {
    timeout: 30_000,
  });

  await second.close();
});
