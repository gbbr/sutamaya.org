import { test, expect, openListsTab, openSuttaList, waitForLocalWrites } from './fixtures';

// A note is a discrete edit — Cmd/Ctrl+Enter commits it, as does leaving the field — and it belongs
// to the sutta, so that sutta's row back in the library marks it, and the "Keywords" auto-list shows it.

test('a note written in the reader marks the sutta row and shows in the Keywords list', async ({ page }) => {
  const listPane = await openSuttaList(page, 'dn-silakkhandhavagga');
  await listPane.getByRole('link', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
  // The reader binds its key handling on mount, so wait for the text before pressing anything.
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // "n" opens the panel on the note and focuses it.
  await page.keyboard.press('n');
  const note = page.getByPlaceholder('Words to find this sutta by');
  await expect(note).toBeFocused();

  await note.fill('the sixty-two views');
  await note.press('ControlOrMeta+Enter');

  await page.keyboard.press('Escape');

  // Back in the library, the row marks the note beside its chips.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/browse\/dn-silakkhandhavagga/);
  await expect(listPane.getByRole('link', { name: /The Divine Net/ }).getByRole('img', { name: 'Has keywords' })).toBeVisible();

  // And the sutta is now in the Keywords auto-list, which is derived rather than stored, and shows the
  // note itself.
  await openListsTab(page);
  await page.getByRole('button', { name: /Keywords/ }).click();
  await expect(page.locator('[data-component="ListPane"]')).toContainText('The Divine Net');
  await expect(page.locator('[data-component="ListPane"]')).toContainText('the sixty-two views');
});

test('a note survives a reload and can be edited', async ({ page }) => {
  // The note reads back through the reader's own "— …" line under the title, which is the signal
  // that the write reached the store rather than sitting in the editor's draft state.
  const write = async (text: string) => {
    await page.keyboard.press('n');
    const note = page.getByPlaceholder('Words to find this sutta by');
    await note.fill(text);
    await note.press('ControlOrMeta+Enter');
    await expect(page.getByRole('button', { name: 'Edit keywords' })).toContainText(text);
    await page.keyboard.press('Escape');
    await waitForLocalWrites(page);
  };

  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await write('first draft');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit keywords' })).toContainText('first draft');

  await write('second draft');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit keywords' })).toContainText('second draft');
});
