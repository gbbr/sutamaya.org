import { test, expect, waitForLocalWrites, type Page } from './fixtures';

// Lists are the reader's own filing: create, fill, reorder, nest, rename, delete. All of it is
// written to the local mirror first, so none of it needs an account.

const listsTree = '[data-component="ListsTreeView"]';

/**
 * The list rows as the tree currently draws them, top to bottom, with nesting flattened — names
 * only, dropping the count badge that shares the row.
 */
async function rowLabels(page: Page): Promise<string[]> {
  const rows = await page.locator(`${listsTree} [data-component="ListRow"] [data-node-id]`).allInnerTexts();
  return rows.map((row) => row.split('\n')[0].trim());
}

async function openLists(page: Page) {
  await page.goto('/browse');
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await expect(page.locator(listsTree)).toBeVisible();
}

async function createTopLevel(page: Page, name: string, kind: 'list' | 'group' = 'list') {
  await page.getByRole('button', { name: 'New list or group' }).click();
  if (kind === 'group') await page.getByRole('button', { name: 'Switch to Group' }).click();
  const input = page.getByPlaceholder(kind === 'group' ? 'Group name — return to create' : 'List name — return to create');
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator(listsTree).getByText(name, { exact: true })).toBeVisible();
}

/** The options toolbar for one row, which is where move/rename/delete live. */
function rowMenu(page: Page, name: string) {
  return page.locator('[data-component="ListRow"]').filter({ hasText: name }).first();
}

test('lists can be created, reordered, renamed and deleted', async ({ page }) => {
  await openLists(page);

  // A new list goes to the top, so the second one created sits above the first.
  await createTopLevel(page, 'Suttas');
  await createTopLevel(page, 'Reading');
  await expect.poll(() => rowLabels(page)).toEqual(['Reading', 'Suttas']);

  // Reordering is a queued operation rather than a stored index, so it has to survive a reload.
  await rowMenu(page, 'Suttas').getByRole('button', { name: 'List options' }).click();
  await rowMenu(page, 'Suttas').getByRole('button', { name: 'Move up' }).click();
  await expect.poll(() => rowLabels(page)).toEqual(['Suttas', 'Reading']);

  await waitForLocalWrites(page);
  await page.reload();
  await expect(page.locator(listsTree)).toBeVisible();
  await expect.poll(() => rowLabels(page)).toEqual(['Suttas', 'Reading']);

  await rowMenu(page, 'Reading').getByRole('button', { name: 'List options' }).click();
  await rowMenu(page, 'Reading').getByRole('button', { name: 'Rename' }).click();
  // Renaming replaces the row's label with an unlabelled field carrying the current name.
  const rename = page.locator(`${listsTree} input`).first();
  await expect(rename).toHaveValue('Reading');
  await rename.fill('Later');
  await rename.press('Enter');
  await expect(page.locator(listsTree).getByText('Later', { exact: true })).toBeVisible();

  // Deleting takes a confirmation, and the prompt names the row.
  await rowMenu(page, 'Later').getByRole('button', { name: 'List options' }).click();
  await rowMenu(page, 'Later').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator(listsTree)).toContainText('Delete "Later"?');
  await rowMenu(page, 'Later').getByRole('button', { name: 'Delete', exact: true }).click();

  // Confirming closes the prompt, whether or not the row has finished leaving the tree — so this
  // separates a click that missed from a delete that didn't happen.
  await expect(page.locator(listsTree)).not.toContainText('Delete "Later"?');
  await expect.poll(() => rowLabels(page)).toEqual(['Suttas']);

  // A delete is a tombstone, not a row removal — it must not come back on the next read.
  await waitForLocalWrites(page);
  await page.reload();
  await expect(page.locator(listsTree)).toBeVisible();
  await expect.poll(() => rowLabels(page)).toEqual(['Suttas']);
});

test('a group holds a nested list', async ({ page }) => {
  await openLists(page);

  await createTopLevel(page, 'Study', 'group');

  await rowMenu(page, 'Study').getByRole('button', { name: 'List options' }).click();
  await rowMenu(page, 'Study').getByRole('button', { name: 'New list in this group' }).click();
  const input = page.getByPlaceholder('List name — return to create');
  await input.fill('Jhana');
  await input.press('Enter');

  await expect.poll(() => rowLabels(page)).toEqual(['Study', 'Jhana']);

  await waitForLocalWrites(page);
  await page.reload();
  await expect(page.locator(listsTree)).toBeVisible();
  await expect.poll(() => rowLabels(page)).toEqual(['Study', 'Jhana']);
});

test('a sutta can be added to a list from the library and taken out again', async ({ page }) => {
  await page.goto('/browse/dn-silakkhandhavagga');

  const listPane = page.locator('[data-component="ListPane"]');
  await listPane.getByRole('button', { name: 'Add DN1 to a list' }).click();

  // Created from inside the picker, which is the path a reader filing their first sutta takes.
  const picker = page.locator('[data-component="ListMembershipPicker"]');
  await picker.getByPlaceholder('Search or create a list').fill('Favourites');
  await picker.getByRole('button', { name: /Create list/ }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await page.locator(listsTree).getByText('Favourites', { exact: true }).click();
  await expect(listPane).toContainText('The Divine Net');

  // Taking it out again goes through the same picker, as a toggle.
  await listPane.getByRole('button', { name: 'Add DN1 to a list' }).click();
  // A checked list is also pinned to the top of the picker, so the name appears twice.
  await picker.getByRole('button', { name: /Favourites/ }).first().click();
  await page.keyboard.press('Escape');

  await expect(listPane.getByRole('button', { name: /The Divine Net/ })).toHaveCount(0);
});
