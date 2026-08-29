import { test, expect, openListsTab, openSuttaList, waitForLocalWrites, type Page } from './fixtures';

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

test('a nested list is dragged out of its group by dropping below the tree', async ({ page }) => {
  // The one part of reordering no other test can reach: jsdom reports every rect as 0x0, so the
  // drop-zone maths is unit-tested against fixture geometry and the gesture itself only happens
  // here. Dropping in the blank space under the tree used to resolve to "after the last row",
  // which — with an expanded group holding the last rows — put the list straight back where it
  // was being dragged from.
  await openLists(page);
  await createTopLevel(page, 'Study', 'group');
  // `[data-node-id]` is the row itself; `[data-component="ListRow"]` is the recursive wrapper,
  // which for a group also contains every descendant's row — so rowMenu() above is ambiguous here.
  const row = (name: string) => page.locator(`${listsTree} [data-node-id]`).filter({ hasText: name });

  // Two of them, and the one dragged is not the last: with a single child, the group's own row is
  // what remains at the bottom of the tree, and that row is top-level — so the drop would land
  // correctly by accident and the test would pass against the bug it exists for.
  for (const name of ['Metta', 'Jhana']) {
    await row('Study').getByRole('button', { name: 'List options' }).click();
    await page.getByRole('button', { name: 'New list in this group' }).click();
    const input = page.getByPlaceholder('List name — return to create');
    await input.fill(name);
    await input.press('Enter');
    await expect(page.locator(listsTree).getByText(name, { exact: true })).toBeVisible();
  }
  await expect.poll(() => rowLabels(page)).toEqual(['Study', 'Jhana', 'Metta']);

  await page.getByRole('button', { name: 'Reorder & nest lists' }).click();

  // The group's count badge is what says whether a row is still inside it; the flattened row list
  // above can't tell nesting from ordering.
  const studyCount = () => row('Study').locator('span').last().innerText();
  await expect.poll(studyCount).toBe('2');

  const grip = (await row('Jhana').locator('[data-drag-handle]').boundingBox())!;
  // Metta is the bottom of the tree, and it is nested — which is the whole point: "after the last
  // row" would mean "inside Study", the group Jhana is being dragged out of.
  const lastRow = (await row('Metta').boundingBox())!;

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // Below the last row, into blank tree — not merely past its midpoint, which is still that row's
  // own "after". In steps, and well past the 6px threshold the drag engages on: one jump would
  // land the pointer without the moves that resolve a drop target.
  await page.mouse.move(grip.x + grip.width / 2, lastRow.y + lastRow.height + 60, { steps: 12 });
  // The drop target is resolved on an animation frame, not on the move itself (see
  // usePointerDragSession), so releasing in the same tick as the last move drops on nothing. A
  // real drag spans many frames; this waits for one.
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done reordering' }).click();

  await expect.poll(studyCount).toBe('1');

  // Out of the group, so collapsing the group no longer hides it.
  await row('Study').click();
  await expect(page.locator(listsTree).getByText('Jhana', { exact: true })).toBeVisible();

  // The move travels as a queued sibling order, so it has to survive a reload rather than only
  // looking right in the tree it was dragged in.
  await waitForLocalWrites(page);
  await page.reload();
  await expect(page.locator(listsTree)).toBeVisible();
  await expect(page.locator(listsTree).getByText('Jhana', { exact: true })).toBeVisible();
});

test('a sutta can be added to a list from the library and taken out again', async ({ page }) => {
  const listPane = await openSuttaList(page, 'dn-silakkhandhavagga');
  await listPane.getByRole('button', { name: 'Add DN1 to a list' }).click();

  // Created from inside the picker, which is the path a reader filing their first sutta takes.
  const picker = page.locator('[data-component="ListMembershipPicker"]');
  await picker.getByPlaceholder('Search or create a list').fill('Favourites');
  await picker.getByRole('button', { name: /Create list/ }).click();
  await page.keyboard.press('Escape');

  await openListsTab(page);
  await page.locator(listsTree).getByText('Favourites', { exact: true }).click();
  await expect(listPane).toContainText('The Divine Net');

  // Taking it out again goes through the same picker, as a toggle.
  await listPane.getByRole('button', { name: 'Add DN1 to a list' }).click();
  // A checked list is also pinned to the top of the picker, so the name appears twice.
  await picker.getByRole('button', { name: /Favourites/ }).first().click();
  await page.keyboard.press('Escape');

  await expect(listPane.getByRole('button', { name: /The Divine Net/ })).toHaveCount(0);
});
