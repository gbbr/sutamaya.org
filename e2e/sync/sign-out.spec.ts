import { test, expect, waitForLocalWrites, writeNote } from '../fixtures';
import { signIn } from '../session';

// Signing out is the adoption test in reverse: the reader goes back to the `local-…` account this
// device had before, so the account's own notes and highlights leave the screen — and the reader
// keeps working, because nothing here needs a session (CLAUDE.md, "Signing in is never required").
//
// Only a browser answers this. The switch is one account id replacing another across a live
// IndexedDB mirror, and what it is judged on is what the reader shows afterwards.

test('signing out puts the device back on its own data, and keeps reading working', async ({ page }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'belongs to the account');

  await page.goto('/settings');
  await page.getByRole('button', { name: /^Sign out/ }).click();

  // With changes still unsynced the first click only arms a confirmation — "Sign out anyway", over
  // a warning that leaving now discards them. Whether that happens is a race against the flush,
  // won on a dev machine and lost on a slower one, so both outcomes are handled rather than
  // assumed. Clicking through it is the honest answer here: the note *is* still queued.
  const anyway = page.getByRole('button', { name: 'Sign out anyway' });
  await expect.poll(async () => !page.url().includes('/settings') || (await anyway.count()) > 0).toBe(true);
  if (await anyway.count()) await anyway.click();

  // Sign-out goes to "/", which restores the last location rather than a fixed page — the reader,
  // here. The account's note is not this device's to show any more.
  await expect(page).toHaveURL(/\/read\/dn1/);
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit note' })).toHaveCount(0);

  // The library agrees: the badge is the signed-out one.
  await page.goto('/browse');
  await expect(page.locator('[data-component="SignedInBadge"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Signed in as/ })).toHaveCount(0);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // And the reader is still fully usable signed out, writing to the local mirror as it did before
  // there was ever an account. On a different sutta, so this note and the account's don't contend:
  // signing back in adopts the local mirror, and two notes on one sutta would settle by mtime —
  // which is the sync specs' business, not this one's.
  await page.goto('/read/dn2');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'belongs to this device');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('belongs to this device');

  // Signing back in brings the account's own note back, and carries the signed-out one up with it.
  await signIn(page, account);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('belongs to this device');

  await page.goto('/read/dn1');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('belongs to the account', {
    timeout: 30_000,
  });
  await waitForLocalWrites(page);
});
