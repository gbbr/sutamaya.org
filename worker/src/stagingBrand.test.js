import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Staging deploys the same build production does, so everything that tells the two apart is done
// on the way out of the Worker: its own icons, its own installed name, its own landing-page links,
// and a noindex on every page. Which deployment a request is on is read from the hostname, so
// these run through SELF against staging's hostnames and need no configuration of their own.
describe('staging branding', () => {
  // The landing page's links into the app are absolute, so left alone staging's landing page would
  // hand the reader straight to production — the one hop that silently leaves the environment.
  it('points the landing page at staging’s own app', async () => {
    const html = await (await SELF.fetch('https://staging.sutamaya.org/')).text();
    expect(html).toContain('https://app.staging.sutamaya.org/');
    expect(html).not.toContain('https://app.sutamaya.org/');
  });

  it('leaves the production landing page pointing at production', async () => {
    const html = await (await SELF.fetch('https://sutamaya.org/')).text();
    expect(html).toContain('https://app.sutamaya.org/');
    expect(html).not.toContain('https://app.staging.sutamaya.org/');
  });

  it('serves the staging icons and iOS name in the app shell', async () => {
    const html = await (await SELF.fetch('https://app.staging.sutamaya.org/settings')).text();
    expect(html).toContain('/icons/staging/favicon-32.png');
    expect(html).toContain('/icons/staging/apple-touch-icon.png');
    expect(html).toContain('content="sutamaya staging"');
    expect(html).not.toContain('/favicon-32-v3.png');
  });

  // A staging install has to land beside the production one on a home screen, not look like it.
  it('installs under its own name and icons', async () => {
    const manifest = await (await SELF.fetch('https://app.staging.sutamaya.org/manifest.webmanifest')).json();
    expect(manifest.name).toBe('sutamaya staging');
    expect(manifest.short_name).toBe('staging');
    expect(manifest.icons.map((icon) => icon.src)).toEqual(
      expect.arrayContaining([expect.stringContaining('icons/staging/')])
    );
  });

  it('tells crawlers not to index anything it serves', async () => {
    const res = await SELF.fetch('https://app.staging.sutamaya.org/settings');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('leaves production’s icons, name and indexing alone', async () => {
    const res = await SELF.fetch('https://app.sutamaya.org/settings');
    const html = await res.text();
    expect(res.headers.get('x-robots-tag')).toBe(null);
    expect(html).toContain('/favicon-32-v3.png');
    expect(html).not.toContain('/icons/staging/');
  });
});
