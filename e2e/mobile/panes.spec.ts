import { test, expect } from '../fixtures';

// Journeys that only exist below LayoutContext's breakpoint, where the library shows one pane at a
// time: getting to a sutta list means leaving the tree, and coming back means the tree has to be
// where it was left. On desktop both panes are on screen at once and none of this happens, which is
// why this directory is in the desktop projects' testIgnore.
//
// useScrollMemory is thoroughly unit-tested, but against a jsdom element whose scrollTop is a plain
// number. Whether a pane that was display:none'd and shown again actually holds its position is a
// question about layout, and only a real browser has one.

test('the tree comes back where it was left after a trip into a sutta list', async ({ page }) => {
  await page.goto('/browse');

  // Expanding several collections makes the tree far longer than a phone screen, so there is a
  // scroll position to lose in the first place — the guard below holds this honest.
  for (const id of ['dn', 'mn', 'an', 'kn']) await page.locator(`[data-node-id="${id}"]`).click();

  const book = page.locator('[data-node-id="dhp"]');
  await book.scrollIntoViewIfNeeded();
  const before = await book.boundingBox();
  expect(before).not.toBeNull();

  // The pane really did scroll — the first collection is now above the top edge. Without this the
  // test would pass on a tree that fits the screen, where there is no position to restore.
  const firstRow = await page.locator('[data-node-id="dn"]').boundingBox();
  expect(firstRow?.y ?? 0).toBeLessThan(0);

  // A leaf group opens its suttas, which on mobile replaces the tree.
  await book.click();
  const listPane = page.locator('[data-component="ListPane"]');
  await expect(listPane).toBeVisible();
  await expect(page.locator('[data-component="TreePane"]')).toBeHidden();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-component="TreePane"]')).toBeVisible();

  // Same row, same place: the collection is still expanded and the pane still scrolled to it. A
  // couple of pixels of tolerance, since this is a real layout rather than an integer.
  await expect(book).toBeVisible();
  const after = await book.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(4);
});
