// Prints a reminder when a deploy has shipped a commit newer than the over-the-air bundle the
// native apps are pinned to for that environment, so a web-only deploy does not silently leave
// native readers behind. Called at the end of scripts/deploy.sh; never fails the deploy.
//
// Usage: node scripts/check-ota-drift.mjs production|staging

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = process.argv[2];
if (env !== 'production' && env !== 'staging') process.exit(0);

// OTA_VERSION lives in each environment's own `vars` block — production's before the `"env":` key,
// staging's after it. Read as text so JSONC comments don't matter.
const text = readFileSync('wrangler.jsonc', 'utf8');
const split = text.indexOf('"env":');
const region = env === 'production' ? text.slice(0, split) : text.slice(split);
const otaVersion = region.match(/"OTA_VERSION":\s*"([^"]*)"/)?.[1] ?? '';
if (!otaVersion) process.exit(0); // nothing published for this environment yet

const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
const sha = head.status === 0 ? head.stdout.trim() : '';
// The version is `<pkgVersion>-<sha>` (with a trailing `-dirty` on an unclean build).
if (!sha || otaVersion.includes(`-${sha}`)) process.exit(0);

console.log(
  `\nNote: the native apps' OTA bundle for ${env} is ${otaVersion}; this deploy shipped ${sha}.\n` +
    `Native readers stay on ${otaVersion} until you run:  npm run release:ota -- --env ${env}\n`
);
