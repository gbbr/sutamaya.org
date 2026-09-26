import { test, expect, openSuttaList, writeNote } from './fixtures';

// Two tabs of the app share one mirror in the browser (docs/offline-sync.md's "Tabs"): each shows
// what the other saved, and neither saves over it.

test('two tabs show and keep each other’s edits', async ({ page, context }) => {
  const listPane = await openSuttaList(page, 'dn-silakkhandhavagga');

  const second = await context.newPage();
  await second.goto('/read/dn2');
  await expect(second.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(second, 'written in the second tab');

  // The first tab shows it without a reload, on the sutta's row.
  await expect(listPane).toContainText('written in the second tab');

  // A save in the first tab keeps it.
  await listPane.getByRole('link', { name: /The Divine Net/ }).click();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'written in the first tab');
  await second.close();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written in the first tab');
  await page.goto('/read/dn2');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written in the second tab');
});
