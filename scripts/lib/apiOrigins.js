// The Worker origin a native bundle calls, per deploy environment — the app hostnames
// wrangler.jsonc routes each environment to. A native build names an environment rather than a
// URL, so a typo is refused instead of shipping a bundle that calls a host nobody answers on.
export const API_ORIGINS = {
  production: 'https://app.sutamaya.org',
  staging: 'https://app.staging.sutamaya.org',
};
