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
