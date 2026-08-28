import { test, expect, setOffline, type Page } from '../fixtures';

// The one thing that needs the real, built service worker: serving the app with the network gone.
// A dev-mode service worker can't do it — Vite serves an unbundled module graph in dev, so there
// is no precache manifest covering the app shell — which is why this project runs against a
// production build rather than the dev server the rest of the suite uses.

/** Resolves once the service worker controls the page, which is what makes a reload survivable. */
async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });
}

test('@offline the app shell and a sutta already read survive the network being cut', async ({ page, errors }) => {
  await page.goto('/read/dn1');
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
  await waitForServiceWorker(page);

  // The first visit is what populates the caches; read it once more online so the sutta text is
  // in there before anything is unplugged.
  await page.reload();
  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');

  await setOffline(page, errors, true);
  await page.reload();

  await expect(page.locator('[data-seg="1"]')).toHaveText('So I have heard.');
});

test('@offline the corpus tree is browsable offline, since it is precached', async ({ page, errors }) => {
  await page.goto('/browse');
  await expect(page.locator('[data-component="TreePane"]')).toContainText('Dīgha Nikāya');
  await waitForServiceWorker(page);
  await page.reload();
  await expect(page.locator('[data-component="TreePane"]')).toContainText('Dīgha Nikāya');

  await setOffline(page, errors, true);
  await page.reload();

  // corpus.json is precached with the shell, so browsing works offline from the first load —
  // even into a collection this device has never opened.
  await expect(page.locator('[data-component="TreePane"]')).toContainText('Dīgha Nikāya');
  await page.locator('[data-node-id="dn"]').click();
  await page.locator('[data-node-id="dn-silakkhandhavagga"]').click();
  await expect(page.locator('[data-component="ListPane"]')).toContainText('The Divine Net');
});

test('@offline a sutta never read is honestly unavailable offline', async ({ page, errors }) => {
  await page.goto('/browse');
  await waitForServiceWorker(page);
  await page.reload();
  await expect(page.locator('[data-component="TreePane"]')).toContainText('Dīgha Nikāya');

  await setOffline(page, errors, true);

  // Per-sutta text is cached as it is read, not precached, so this one isn't there. What matters
  // is that the reader says so rather than hanging or showing an empty page.
  await page.goto('/read/dn10');
  await expect(page.locator('[data-component="ReaderPage"]')).toBeVisible();
  await expect(page.locator('[data-seg="1"]')).toHaveCount(0);
});
