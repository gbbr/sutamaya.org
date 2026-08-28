import { test, expect, setOffline, waitForLocalWrites, type Page } from '../fixtures';
import { signIn } from '../session';

// Edits made with the network genuinely cut, and what happens when it comes back. These need no
// service worker — nothing reloads while offline — so they run against the ordinary dev server
// alongside the rest of the suite. Serving a page with the network down is the service worker's
// job and is tested separately, in e2e/offline/.

async function writeNote(page: Page, text: string) {
  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Add a note — return to save');
  await note.fill(text);
  await note.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText(text);
  await page.keyboard.press('Escape');
  await waitForLocalWrites(page);
}

test('an edit made offline reaches the account once the network is back', async ({ page, browser, errors }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await setOffline(page, errors, true);
  // The local write is the durable one: it lands whether or not anything can be sent.
  await writeNote(page, 'written with no network');

  await setOffline(page, errors, false);

  // A second device on the same account, with its own empty mirror — so anything it shows had to
  // come back from the Worker.
  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  await other.goto('/read/dn1');
  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('written with no network', {
    timeout: 30_000,
  });

  await second.close();
});

test('two devices editing the same note offline converge on the later edit', async ({ browser, errors }) => {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [first, second] = await Promise.all(contexts.map((c) => c.newPage()));

  // One account, two devices: the first call takes an account from the pool and the second joins
  // it. Signing each in separately would give them an account each and prove nothing.
  const account = await signIn(first);
  await signIn(second, account);

  for (const page of [first, second]) {
    await page.goto('/read/dn1');
    await expect(page.locator('[data-seg="1"]')).toBeVisible();
    await setOffline(page, errors, true);
  }

  // Both edit the same note with no way to see each other. The second write is stamped later, so
  // last-writer-wins settles on it — the losing edit is discarded silently, by design.
  await writeNote(first, 'edited on the first device');
  await writeNote(second, 'edited on the second device');

  // Reconnected in the opposite order to the one they were written in, so this is an assertion
  // about the mtime rather than about who spoke last.
  await setOffline(second, errors, false);
  await setOffline(first, errors, false);

  for (const page of [first, second]) {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('edited on the second device', {
      timeout: 30_000,
    });
  }

  await Promise.all(contexts.map((c) => c.close()));
});

test('a list deleted on one device stays deleted on the other', async ({ browser }) => {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [first, second] = await Promise.all(contexts.map((c) => c.newPage()));

  const account = await signIn(first);
  await signIn(second, account);

  for (const page of [first, second]) {
    await page.goto('/browse');
    await page.getByRole('button', { name: 'Lists', exact: true }).click();
  }

  await first.getByRole('button', { name: 'New list or group' }).click();
  const input = first.getByPlaceholder('List name — return to create');
  await input.fill('Doomed');
  await input.press('Enter');

  const secondTree = second.locator('[data-component="ListsTreeView"]');
  await expect(async () => {
    await second.reload();
    await expect(secondTree.getByText('Doomed', { exact: true })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  // Deleted on the first device while the second still holds its own copy. The delete is a
  // tombstone, so the second device must not push its copy back up as a resurrection.
  const row = first.locator('[data-component="ListRow"]').filter({ hasText: 'Doomed' }).first();
  await row.getByRole('button', { name: 'List options' }).click();
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(first.locator('[data-component="ListsTreeView"]').getByText('Doomed', { exact: true })).toHaveCount(0);

  await expect(async () => {
    await second.reload();
    await expect(secondTree.getByText('Doomed', { exact: true })).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  await Promise.all(contexts.map((c) => c.close()));
});
