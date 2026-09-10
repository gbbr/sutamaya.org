import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';

const published = {
  ...env,
  WEB_ORIGIN: 'https://app.sutamaya.org',
  OTA_VERSION: '2026.09.10-1',
  OTA_CHECKSUM: 'a'.repeat(64),
};

function check(overrideEnv = env, body = { platform: 'ios' }) {
  return app.request(
    '/api/updates/check',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    overrideEnv
  );
}

describe('POST /api/updates/check', () => {
  it('reports no update when nothing is published', async () => {
    const res = await check();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('names the published bundle, checksum and a same-origin download URL', async () => {
    const res = await check(published);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '2026.09.10-1',
      checksum: 'a'.repeat(64),
      url: 'https://app.sutamaya.org/api/updates/bundle/sutamaya-2026.09.10-1.zip',
    });
  });

  it('reports no update when only one of version/checksum is set', async () => {
    const res = await check({ ...env, OTA_VERSION: '2026.09.10-1' });
    expect(await res.json()).toEqual({});
  });

  describe('native-version floor', () => {
    const floored = { ...published, OTA_MIN_NATIVE: '7' };

    it('serves a device at or above the floor', async () => {
      const res = await check(floored, { platform: 'android', version_code: '7' });
      expect((await res.json()).version).toBe('2026.09.10-1');
    });

    it('withholds from a device below the floor', async () => {
      const res = await check(floored, { platform: 'android', version_code: '6' });
      expect(await res.json()).toEqual({});
    });

    it('withholds when the request carries no readable native version', async () => {
      const res = await check(floored, { platform: 'android' });
      expect(await res.json()).toEqual({});
    });

    it('ignores the floor when OTA_MIN_NATIVE is unset', async () => {
      const res = await check(published, { platform: 'android' });
      expect((await res.json()).version).toBe('2026.09.10-1');
    });
  });
});

describe('GET /api/updates/bundle/:file', () => {
  it('streams the zip from R2, cached hard rather than no-store', async () => {
    await env.OTA_BUCKET.put('sutamaya-2026.09.10-1.zip', 'PK pretend zip');
    const res = await app.request('/api/updates/bundle/sutamaya-2026.09.10-1.zip', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('PK pretend zip');
  });

  it('404s an unknown bundle', async () => {
    const res = await app.request('/api/updates/bundle/sutamaya-does-not-exist.zip', {}, env);
    expect(res.status).toBe(404);
  });

  it('404s a filename outside the bundle shape', async () => {
    const res = await app.request('/api/updates/bundle/..%2f..%2fsecret', {}, env);
    expect(res.status).toBe(404);
  });
});
