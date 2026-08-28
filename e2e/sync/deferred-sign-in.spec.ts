import { test, expect, selectWithinSegment, segmentText, waitForLocalWrites, writeNote } from '../fixtures';
import { signIn } from '../session';

// Reading, highlighting and note-taking all work signed out, against a `local-…` account of this
// device's own (lib/localAccount.ts). Signing in later has to keep that work: the local mirror is
// adopted onto the account (adoptMirror) and the ordinary flush carries it up.
//
// `adoptMirror` is thoroughly unit-tested as a state transition. What is only true in a browser is
// the journey around it — data written to a real IndexedDB under one account id, a sign-in that
// changes which id the app is reading, and a flush that has to reach the Worker afterwards. This
// is the app's central promise ("Signing in is never required"), so it gets an end-to-end test.

test('work done signed out is adopted onto the account at sign-in', async ({ page, browser }) => {
  // The account badge lives in the library's header (TreePane), not in the reader.
  await page.goto('/browse');
  const badge = page.locator('[data-component="SignedInBadge"]');
  await expect(badge).toBeVisible();
  // Signed out and nothing local yet, so no "only on this device" dot.
  await expect(page.locator('[data-component="SignedInBadgeDot"]')).toHaveCount(0);

  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

  await writeNote(page, 'written before signing in');

  const phrase = (await segmentText(page, 1)).slice(3, 16);
  await selectWithinSegment(page, 1, 3, 16);
  await page.locator('[data-component="HighlightPopup"]').locator('button').first().click();
  await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(phrase);
  await waitForLocalWrites(page);

  // Work that only this device holds is marked as such, which is the whole reason a reader would
  // sign in later.
  await page.goto('/browse');
  await expect(page.locator('[data-component="SignedInBadgeDot"]')).toBeVisible();

  // Signing in. The real flows are a Google redirect and an emailed code, neither of which a test
  // can drive; both end in the same session cookie and the same reload, which is what this is.
  const account = await signIn(page);
  await page.reload();

  await expect(page.getByRole('button', { name: /Signed in as/ })).toBeVisible();
  await expect(page.locator('[data-component="SignedInBadgeDot"]')).toHaveCount(0);

  // Nothing was lost in the handover: the same device still shows both.
  await page.goto('/read/dn1');
  await expect(page.getByRole('button', { name: 'Edit note' })).toContainText('written before signing in');
  await expect(page.locator('[data-seg="1"] [data-hl-id]')).toHaveText(phrase);

  // A second device on the same account, with a mirror of its own — so anything it shows had to
  // travel through the Worker rather than sitting in local storage.
  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, account);
  await other.goto('/read/dn1');

  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('written before signing in', {
    timeout: 30_000,
  });
  await expect(other.locator('[data-seg="1"] [data-hl-id]')).toHaveText(phrase, { timeout: 30_000 });

  await second.close();
});

// The other half of the same promise: a reader who signs in on a device that has nothing of its own
// must not have their account wiped by the empty mirror that device starts with.
test('signing in on a fresh device does not erase what the account already holds', async ({ page, browser }) => {
  const account = await signIn(page);
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toBeVisible();
  await writeNote(page, 'made on the first device');

  const second = await browser.newContext();
  const other = await second.newPage();

  // Signed out first, and it does read a sutta — so this device has a local mirror of its own,
  // just an empty one where the account's data is concerned.
  await other.goto('/read/dn1');
  await expect(other.locator('[data-seg="1"]')).toBeVisible();
  await expect(other.getByRole('button', { name: 'Edit note' })).toHaveCount(0);

  await signIn(other, account);
  await other.reload();

  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('made on the first device', {
    timeout: 30_000,
  });

  // And the account still has it after the adoption has flushed back — an empty local mirror must
  // not have written tombstones over it.
  await other.reload();
  await expect(other.getByRole('button', { name: 'Edit note' })).toContainText('made on the first device');

  await second.close();
});
