import { beforeEach, describe, expect, it, vi } from 'vitest';

const written = vi.hoisted(() => [] as { path: string; data: string }[]);
const shared = vi.hoisted(() => [] as { files?: string[] }[]);
const shareResult = vi.hoisted(() => ({ throws: null as Error | null }));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      written.push({ path, data });
    },
    getUri: async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` }),
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: async (opts: { files?: string[] }) => {
      shared.push(opts);
      if (shareResult.throws) throw shareResult.throws;
    },
  },
}));

vi.mock('./api', () => ({
  dataApi: { exportPayload: async () => ({ email: 'a@b.com', lists: [] }) },
}));

beforeEach(() => {
  written.length = 0;
  shared.length = 0;
  shareResult.throws = null;
});

describe('shareUserDataExport', () => {
  it('writes the fetched payload to the cache and offers that file', async () => {
    const { shareUserDataExport } = await import('./exportData');
    await shareUserDataExport();

    expect(written).toEqual([
      { path: 'sutamaya-export.json', data: JSON.stringify({ email: 'a@b.com', lists: [] }) },
    ]);
    expect(shared[0].files).toEqual(['file:///cache/sutamaya-export.json']);
  });

  it('treats a dismissed share sheet as done, not as a failure', async () => {
    shareResult.throws = new Error('Share canceled');
    const { shareUserDataExport } = await import('./exportData');
    await expect(shareUserDataExport()).resolves.toBeUndefined();
  });

  it('reports a share that actually failed', async () => {
    shareResult.throws = new Error('no activity found to handle intent');
    const { shareUserDataExport } = await import('./exportData');
    await expect(shareUserDataExport()).rejects.toThrow(/no activity/);
  });
});
