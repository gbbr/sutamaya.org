import { test, expect, waitForLocalWrites, writeNote } from '../fixtures';
import { signIn } from '../session';
import type { Page } from '@playwright/test';

// Deleting the account is the one irreversible thing the app can do, and it has to land in three
// places at once: the server erases the account, the device that asked for it goes back to being a
// signed-out reader with nothing of the account left on it, and every other device that still
// believes in the account drops its copy instead of pushing it back up.
//
// Only a browser answers that last part. It is a live page holding an account in memory, a real
// Worker refusing it, and an IndexedDB mirror being thrown away — none of which a unit test with a
// mocked store can put together.

/** The account ids this device is holding mirrors for — what "nothing is left behind" is judged on. */
function mirroredAccounts(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('sutamaya');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('mirrors')) return resolve([]);
          const all = db.transaction('mirrors', 'readonly').objectStore('mirrors').getAll();
          all.onerror = () => resolve([]);
          all.onsuccess = () => resolve((all.result as Array<{ userId: string }>).map((m) => m.userId));
        };
      })
  );
}

test('deleting the account empties this device and resets the other one', async ({ page, browser }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'written before the account went');

  // A second device on the same account, with its own mirror: what it shows came back from the
  // Worker, so it is genuinely holding the account rather than echoing this page.
  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);

  // Watched from before the deletion, because 410 is the whole mechanism here: it is the only thing
  // that tells a device with a perfectly valid session cookie that its account is gone. Without
  // this the test would still pass on a page that merely happened to look empty.
  const refused: string[] = [];
  other.on('response', (res) => {
    if (res.status() === 410 && res.url().includes('/api/')) refused.push(res.url());
  });

  await other.goto('/read/dn1');
  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('written before the account went', {
    timeout: 20_000,
  });

  // The deletion itself, from the first device.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();

  // The confirmation names what goes and where it goes from, rather than asking a bare "are you
  // sure" about a word the reader would have to already know the meaning of.
  await expect(page.getByText(/lists, notes, highlights and reading history, on every device/)).toBeVisible();

  // Typing DELETE is the whole of the intent check — these accounts have no password to re-enter —
  // so the button staying dead until then is the guard, not decoration.
  const confirmButton = page.getByRole('button', { name: 'Delete my account' });
  await expect(confirmButton).toBeDisabled();
  await page.getByLabel(/to confirm/).fill('DELETE');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  // Settings hands the reader back to where they were, as its back arrow does.
  await expect(page).toHaveURL(/\/read\/dn1/);
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // Signed out, on a fresh local account: the note was the account's, not this device's.
  await expect(page.getByRole('button', { name: 'Edit note' })).toHaveCount(0);
  await page.goto('/browse');
  await expect(page.locator('[data-component="SignedInBadge"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Signed in as/ })).toHaveCount(0);

  // And nothing of the account is left on the device for whoever picks it up next.
  await waitForLocalWrites(page);
  expect(await mirroredAccounts(page)).not.toContain(account);

  // The reader still works, because signing in was never what made it work.
  await page.goto('/read/dn2');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'written by nobody in particular');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written by nobody in particular');

  // The second device has heard nothing: it was never reloaded, so its session check has not re-run
  // and it still holds the account in memory. Writing is what sends it to the server — and the push
  // is refused rather than recreating anything, which is the point of the whole exercise.
  await other.keyboard.press('n');
  const note = other.getByPlaceholder('Something to remember this by');
  await note.fill('written on a device that had not heard yet');
  await note.press('ControlOrMeta+Enter');
  await other.keyboard.press('Escape');

  await expect.poll(() => refused.length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Having been refused, it resets itself rather than retrying or asking for a sign-in: both notes
  // go, the account's and the one just written onto it.
  await expect(other.getByRole('button', { name: 'Edit note' })).toHaveCount(0, { timeout: 30_000 });
  await expect(other.locator('[data-seg="1"]')).toBeVisible();
  await expect.poll(() => mirroredAccounts(other), { timeout: 15_000 }).not.toContain(account);

  await second.close();
});
