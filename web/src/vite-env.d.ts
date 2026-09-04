/// <reference types="vite/client" />
// Types for `virtual:pwa-register`, the service-worker registration main.tsx calls.
/// <reference types="vite-plugin-pwa/client" />

// The commit this build was made from, substituted by vite.config.ts's `define`.
declare const __BUILD_COMMIT_ID__: string;
declare const __BUILD_COMMIT_SUBJECT__: string;

// Empty on purpose: the OAuth client id and secret are the Worker's business — the browser only
// navigates to /api/auth/google/start — so the frontend build takes no auth config.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
