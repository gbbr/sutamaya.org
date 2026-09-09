import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Served by the Worker rather than the asset router — see wellKnown.js and `run_worker_first` in
// wrangler.jsonc. Through SELF, which traverses the asset layer the way a real request does.
describe('/.well-known/assetlinks.json', () => {
  it('authorises the Android app to open app.sutamaya.org links', async () => {
    const res = await SELF.fetch('https://app.sutamaya.org/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].relation).toContain('delegate_permission/common.handle_all_urls');
    expect(body[0].target.package_name).toBe('org.sutamaya.app');
    expect(body[0].target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
  });
});

describe('/.well-known/apple-app-site-association', () => {
  it('is not served until an Apple Team ID is configured', async () => {
    const res = await SELF.fetch('https://app.sutamaya.org/.well-known/apple-app-site-association');
    expect(res.status).toBe(404);
  });

  it('claims the app screens and leaves /api out of them', async () => {
    const { default: app } = await import('./index.js');
    const res = await app.request('/.well-known/apple-app-site-association', {}, { APPLE_TEAM_ID: 'ABCDE12345' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const [detail] = (await res.json()).applinks.details;
    expect(detail.appIDs).toEqual(['ABCDE12345.org.sutamaya.app']);
    const paths = detail.components.map((component) => component['/']);
    expect(paths).toEqual(['/', '/browse/*', '/read/*', '/settings', '/help']);
    // The OAuth round trip has to finish in the browser that started it, so no filter may pull it
    // into the app — the same reason the Android manifest lists paths instead of the bare host.
    expect(paths.some((path) => path.startsWith('/api'))).toBe(false);
  });
});
