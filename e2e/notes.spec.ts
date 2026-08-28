import { test, expect, waitForLocalWrites } from './fixtures';

// A note is a discrete edit — Enter commits it — and it belongs to the sutta, so it shows up on
// that sutta's row back in the library and in the synthesized "Notes" auto-list.

test('a note written in the reader shows on the sutta row and in the Notes list', async ({ page }) => {
  await page.goto('/browse/dn-silakkhandhavagga');
  await page.locator('[data-component="ListPane"]').getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
  // The reader binds its key handling on mount, so wait for the text before pressing anything.
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // "n" opens the panel on the note and focuses it.
  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Add a note — return to save');
  await expect(note).toBeFocused();

  await note.fill('the sixty-two views');
  await note.press('Enter');

  await page.keyboard.press('Escape');

  // Back in the library, the row carries the note under the title.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/browse\/dn-silakkhandhavagga/);
  await expect(page.locator('[data-component="ListPane"]')).toContainText('the sixty-two views');

  // And the sutta is now in the Notes auto-list, which is derived rather than stored.
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await page.getByRole('button', { name: /Notes/ }).click();
  await expect(page.locator('[data-component="ListPane"]')).toContainText('The Divine Net');
});

test('a note survives a reload and can be edited', async ({ page }) => {
  // The note reads back through the reader's own "— …" line under the title, which is the signal
  // that the write reached the store rather than sitting in the editor's draft state.
  const write = async (text: string) => {
    await page.keyboard.press('n');
    const note = page.getByPlaceholder('Add a note — return to save');
    await note.fill(text);
    await note.press('Enter');
    await expect(page.getByRole('button', { name: 'Edit note' })).toContainText(text);
    await page.keyboard.press('Escape');
    await waitForLocalWrites(page);
  };

  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await write('first draft');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('first draft');

  await write('second draft');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('second draft');
});
