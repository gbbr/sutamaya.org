// What the staging deployment shows at the foot of the tree pane, so it's plain which change is
// running there. Production ships the same values and displays none of them.

// The short id of the commit this build was made from, with a trailing "*" when the working tree
// was dirty at build time. Empty where git couldn't answer, and under the test runner, which
// compiles these modules without vite.config.ts's `define`.
export const BUILD_COMMIT_ID: string = typeof __BUILD_COMMIT_ID__ === 'string' ? __BUILD_COMMIT_ID__ : '';

// That commit's subject line.
export const BUILD_COMMIT_SUBJECT: string =
  typeof __BUILD_COMMIT_SUBJECT__ === 'string' ? __BUILD_COMMIT_SUBJECT__ : '';

// The app's staging hostname — see the `staging` environment in wrangler.jsonc.
const STAGING_HOST = 'app.staging.sutamaya.org';

// Whether this is the staging deployment. Read from the hostname rather than a build flag, because
// staging deploys the same artifact production does.
export const IS_STAGING = typeof location !== 'undefined' && location.hostname === STAGING_HOST;
