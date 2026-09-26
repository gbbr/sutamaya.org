import { beforeEach, describe, expect, it, vi } from 'vitest';

const written = vi.hoisted(() => [] as { path: string; data: string }[]);
const shared = vi.hoisted(() => [] as { files?: string[] }[]);
const shareResult = vi.hoisted(() => ({ throws: null as Error | null }));
const saved = vi.hoisted(() => [] as { file: string; type: string }[]);
const saveFile = vi.hoisted(() => ({ available: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: (name: string) => name === 'SaveFile' && saveFile.available },
  registerPlugin: () => ({
    saveAs: async (opts: { file: string; type: string }) => {
      saved.push(opts);
    },
  }),
}));

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

vi.mock('../api', () => ({
  dataApi: { exportPayload: async () => ({ email: 'a@b.com', lists: [] }) },
}));

beforeEach(() => {
  written.length = 0;
  shared.length = 0;
  shareResult.throws = null;
  saved.length = 0;
  saveFile.available = false;
});

describe('shareUserDataExport', () => {
  it('writes the fetched payload to the cache and offers that file', async () => {
    const { shareUserDataExport } = await import('../exportData');
    await shareUserDataExport();

    expect(written).toEqual([
      { path: 'sutamaya-export.json', data: JSON.stringify({ email: 'a@b.com', lists: [] }) },
    ]);
    expect(shared[0].files).toEqual(['file:///cache/sutamaya-export.json']);
  });

  it('offers the file to the "Save as" picker instead where the app has one', async () => {
    saveFile.available = true;
    const { shareUserDataExport } = await import('../exportData');
    await shareUserDataExport();

    expect(saved).toEqual([{ file: 'file:///cache/sutamaya-export.json', type: 'application/json' }]);
    expect(shared).toEqual([]);
  });

  it('treats a dismissed share sheet as done, not as a failure', async () => {
    shareResult.throws = new Error('Share canceled');
    const { shareUserDataExport } = await import('../exportData');
    await expect(shareUserDataExport()).resolves.toBeUndefined();
  });

  it('reports a share that actually failed', async () => {
    shareResult.throws = new Error('no activity found to handle intent');
    const { shareUserDataExport } = await import('../exportData');
    await expect(shareUserDataExport()).rejects.toThrow(/no activity/);
  });
});
