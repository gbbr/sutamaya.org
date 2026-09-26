import { describe, expect, it } from 'vitest';
import { comparableContract } from '../nativeContract.js';

// same reports whether two versions of a contract file compare equal.
const same = (a, b) => comparableContract(a) === comparableContract(b);

const config = `import type { CapacitorConfig } from '@capacitor/cli';

// The Worker origin the update check is made against.
const apiBase = process.env.SUTAMAYA_API_BASE || 'https://app.sutamaya.org';

const config: CapacitorConfig = {
  appId: 'org.sutamaya.app',
  plugins: {
    // Style is driven from the app theme at runtime (lib/statusBar.ts). Edge-to-edge is the
    // platform default.
    StatusBar: {
      overlaysWebView: true,
    },
    CapacitorUpdater: {
      updateUrl: \`\${apiBase}/api/ota/check\`,
    },
  },
};
`;

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <!-- The OAuth deep link back from the system browser -->
        <intent-filter>
            <data android:scheme="sutamaya" />
        </intent-filter>
    </application>

    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

describe('comparableContract', () => {
  it('ignores a reworded comment', () => {
    expect(same(config, config.replace('lib/statusBar.ts', 'lib/native/statusBar.ts'))).toBe(true);
  });

  it('ignores comment and blank lines added or removed', () => {
    expect(same(config, config.replace('// The Worker origin the update check is made against.\n', ''))).toBe(true);
    expect(same(config, config.replace('    CapacitorUpdater', '    // Updates.\n\n    CapacitorUpdater'))).toBe(true);
  });

  it('ignores XML comments, on one line or several', () => {
    const edited = manifest
      .replace('<!-- Permissions -->', '<!-- What the app may do -->')
      .replace('<!-- The OAuth deep link back from the system browser -->', '<!-- The OAuth deep link,\n             back from the browser -->');
    expect(same(manifest, edited)).toBe(true);
  });

  it('ignores the version fields', () => {
    expect(same('versionCode 2\nversionName "1.0.0"\n', 'versionCode 3\nversionName "1.0.1"\n')).toBe(true);
    expect(same('CURRENT_PROJECT_VERSION = 4;\nMARKETING_VERSION = 1.0;\n', 'CURRENT_PROJECT_VERSION = 5;\nMARKETING_VERSION = 1.0.1;\n')).toBe(true);
  });

  it('sees a changed setting', () => {
    expect(same(config, config.replace('overlaysWebView: true', 'overlaysWebView: false'))).toBe(false);
  });

  it('sees a changed URL, though it holds a //', () => {
    expect(same(config, config.replace('https://app.sutamaya.org', 'https://staging.sutamaya.org'))).toBe(false);
  });

  it('sees a setting added beside a comment', () => {
    expect(same(config, config.replace('    StatusBar: {', '    SplashScreen: {},\n    StatusBar: {'))).toBe(false);
  });

  it('sees an added permission', () => {
    const edited = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />',
    );
    expect(same(manifest, edited)).toBe(false);
  });
});
