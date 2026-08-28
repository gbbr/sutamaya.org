import { test, expect, openSuttaList, selectWithinSegment, waitForLocalWrites, writeNote } from './fixtures';

// Moving around the reader: Prev/Next at the foot of the text, the same by keyboard, the
// breadcrumb back into the tree, and closing.

test('@smoke Prev/Next step through the collection', async ({ page }) => {
  const listPane = await openSuttaList(page, 'dn-silakkhandhavagga');
  await listPane.getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/read\/dn2/);
  // The step animates the outgoing sutta out, so both titles are briefly in the DOM.
  await expect(page.getByRole('heading', { name: 'The Fruits of the Ascetic Life' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
});

test('@smoke the breadcrumb goes back to the sutta list it belongs to', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Entire Spectrum of Ethics' }).click();
  await expect(page).toHaveURL(/\/browse\/dn-silakkhandhavagga/);
  await expect(page.locator('[data-component="ListPane"]')).toContainText('The Divine Net');
});

// Where a sutta opens is a deliberate distinction (lib/entryKind.ts): a refresh, a back, or the app
// relaunching is a *return* and resumes; tapping a row or Prev/Next is a *fresh* entry and starts at
// the top. `entryKind.test.ts` covers the classification; what only a browser can answer is whether
// the position is actually reached, in a layout that keeps changing height under the restore.
test('a refresh resumes the reading, even as notes and highlights land after the text', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // Annotations are the second content wave: they come from the local mirror a beat after the text,
  // and both of these change the height of what sits above the reading position — the note renders
  // under the title, the highlight adds its gutter mark.
  await writeNote(page, 'something above the fold');
  await selectWithinSegment(page, 1, 3, 16);
  await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();
  await expect(page.locator('[data-seg="1"] [data-hl-id]')).toBeVisible();
  await waitForLocalWrites(page);

  const marker = page.locator('[data-seg="40"]');
  await marker.evaluate((el) => el.scrollIntoView({ block: 'center' }));

  // The reader really is scrolled: the first segment is above the top edge. Without this the
  // assertion below would hold trivially on a document that never moved.
  expect((await page.locator('[data-seg="1"]').boundingBox())?.y ?? 0).toBeLessThan(0);

  await page.reload();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // Back at the reading position rather than at the top or the bottom — which is the promise, and
  // all of it. What is stored is a scroll *offset*, so when the annotations render after the
  // restore (a slower device, a colder cache) the text above the position grows and the same offset
  // shows text a line or two earlier. Demanding the exact pixel would be asserting the speed of
  // IndexedDB, not the behaviour.
  await expect(marker).toBeInViewport();
});

// A jump made while the document is still settling has to stick: the scroll restore is still
// watching at that point, and a correction arriving late would drag the reader off the heading they
// just asked for. Nothing about this is visible without layout.
test('a Contents jump taken right after load lands and holds', async ({ page }) => {
  await page.goto('/read/dn2');
  const contents = page.locator('[data-component="ReaderPage"] nav').filter({ hasText: 'Contents' });
  await expect(contents).toBeVisible();

  // Clicked as soon as the list is there, with no settling wait of the test's own.
  await contents.getByRole('button').nth(4).click();

  // Whichever segment the jump brings to the top — read from the page rather than hardcoded, so a
  // corpus refresh renumbering the segments doesn't quietly retarget this. Sampled once the
  // animation has settled (scrollToSegment animates), since mid-flight the top segment is just
  // whichever one the scroll is passing.
  const topSegment = () =>
    page.evaluate(() => {
      const segs = [...document.querySelectorAll('[data-seg]')] as HTMLElement[];
      const closest = segs.reduce((a, b) =>
        Math.abs(b.getBoundingClientRect().y) < Math.abs(a.getBoundingClientRect().y) ? b : a
      );
      return closest.getAttribute('data-seg');
    });
  let previous = '';
  await expect
    .poll(async () => {
      const now = (await topSegment()) ?? '';
      const settled = now !== '' && now === previous;
      previous = now;
      return settled;
    })
    .toBe(true);

  const target = page.locator(`[data-seg="${previous}"]`);
  const landed = (await target.boundingBox())?.y ?? 1e6;
  expect(landed).toBeLessThan(200);

  // A fixed wait, unusually: the assertion is that nothing further happens, and there is no event
  // to poll for the absence of. The bound is loose because what it rules out is coarse — a stray
  // restore would drag the reader thousands of pixels away, while a late-rendering line above the
  // target legitimately nudges it by one.
  await page.waitForTimeout(800);
  expect(Math.abs(((await target.boundingBox())?.y ?? 1e6) - landed)).toBeLessThan(200);
});

test('Prev/Next starts the next sutta at the top instead of resuming it', async ({ page }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.locator('[data-seg="40"]').scrollIntoViewIfNeeded();
  expect((await page.locator('[data-seg="1"]').boundingBox())?.y ?? 0).toBeLessThan(0);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/read\/dn2/);

  // Back to the sutta that has a remembered position, but by a fresh navigation rather than a
  // return — so it opens at the top, which is the point of the distinction. The top of the document
  // is its breadcrumb: the first segment sits well over a screen below it, under the title, the
  // read time and the blurb.
  await page.getByRole('button', { name: 'Prev' }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
  await expect(page.locator('[data-component="ReaderPage"] nav').first()).toBeInViewport();
  await expect(page.locator('[data-seg="40"]')).not.toBeInViewport();
});

// A breadcrumb click's whole point is to show where the sutta sits, so the tapped row has to be
// revealed — even when the tree was left collapsed over it on the previous visit, which used to
// swallow it (TreePane restores a collapsed tree verbatim when a mount lands on the node it last
// persisted; a breadcrumb arrival is the exception). Only a browser can answer this: the reveal is
// an expansion plus a scroll, and the collapse it has to beat is read back from localStorage.
test('a breadcrumb click reveals its row even when the tree was left collapsed over it', async ({ page }) => {
  const listPane = await openSuttaList(page, 'dn-silakkhandhavagga');
  await listPane.getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  // An ancestor above the sutta's own group, which is the click that lands in the tree pane —
  // on mobile, the only pane then showing.
  const crumb = (name: string) => page.locator('[data-component="ReaderPage"] nav').getByRole('button', { name });
  await crumb('Dīgha Nikāya').click();

  const vagga = page.locator('[data-node-id="dn-silakkhandhavagga"]');
  await expect(vagga).toBeVisible();

  // Collapsing the nikaya by hand hides that row, and the collapse is persisted for the next mount.
  await page.locator('[data-node-id="dn"]').click();
  await expect(vagga).not.toBeVisible();

  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await crumb('Dīgha Nikāya').click();

  await expect(vagga).toBeVisible();
});

test('closing the reader returns to where it was opened from, not the sutta’s place in the canon', async ({
  page,
}) => {
  // A highlight puts dn1 into the synthesized Highlights list, giving a second, quite different
  // route to the same sutta — which is what makes "where you came from" testable at all.
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await selectWithinSegment(page, 1, 3, 16);
  await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();
  await expect(page.locator('[data-seg="1"] [data-hl-id]')).toBeVisible();

  await page.goto('/browse');
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await page.locator('[data-component="ListsTreeView"]').getByRole('button', { name: /Highlights/ }).click();

  const listPane = page.locator('[data-component="ListPane"]');
  await expect(listPane).toContainText('The Divine Net');
  await listPane.getByRole('button', { name: /The Divine Net/ }).click();
  await expect(page).toHaveURL(/\/read\/dn1/);
  // The reader binds its key handling on mount, so wait for the text before pressing anything.
  await expect(page.locator('[data-seg="1"]')).toBeVisible();

  await page.keyboard.press('Escape');
  // Back to the Highlights list, not to dn1's vagga in the corpus tree.
  await expect(page).toHaveURL(/auto-highlights/);
});
