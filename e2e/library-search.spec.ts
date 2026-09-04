import { test, expect, searchResults } from './fixtures';

// Search is how a reader who knows what they want gets there without walking the tree. It matches
// ref, title, Pali, blurb, note and list names, and the sutta text itself in both languages — see
// docs/search.md. A title match outranks every text match, so the sutta named by the query leads.

test('@smoke a search finds a sutta by its English title and opens it', async ({ page }) => {
  await page.goto('/browse');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const box = page.getByPlaceholder('Search suttas, text and lists');
  await box.fill('Divine Net');

  // Matched on the ref and title together: other suttas mention the Brahmajāla in their text and
  // now match the words too, so neither half alone picks out one row.
  const hits = searchResults(page);
  const dn1 = hits.getByRole('button', { name: /^DN1The Divine Net/ });
  await expect(dn1).toBeVisible();

  await dn1.click();
  await expect(page).toHaveURL(/\/read\/dn1/);
});

test('@smoke a search finds a phrase that is only in the sutta text', async ({ page }) => {
  await page.goto('/browse');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  // In the text of the fire sermon and in no title, ref or blurb — unfindable before the text
  // was searchable.
  await page.getByPlaceholder('Search suttas, text and lists').fill('burning with the fires of greed');

  // The text index has to load and get scanned before the hit shows up, which can outrun the
  // suite's default timeout on a cold CI runner.
  const hits = searchResults(page);
  await expect(hits.getByText('Searching sutta text…')).toBeHidden({ timeout: 15000 });

  // The snippet is the row's own evidence: the passage the phrase was found in, centred on it.
  await expect(hits.getByRole('button', { name: /^SN35\.28/ })).toContainText(
    /burning with the fires of greed/i
  );
});

test('@smoke without the sutta text, search says so and still answers', async ({ page, errors }) => {
  // The reader who is offline, or whose fetch failed: metadata results, honestly labelled. The
  // blocked fetch is a console error by definition, which is what this test is arranging.
  errors.allowNetworkFailures = true;
  await page.route('**/data/search/**', (route) => route.abort());
  await page.goto('/browse');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByPlaceholder('Search suttas, text and lists').fill('zzzznotasutta');
  await expect(searchResults(page)).toContainText('not the text of the suttas');

  // Degraded, not broken — a title still finds its sutta.
  await page.getByPlaceholder('Search suttas, text and lists').fill('Divine Net');
  await expect(searchResults(page).getByRole('button', { name: /^DN1The Divine Net/ })).toBeVisible();
});
