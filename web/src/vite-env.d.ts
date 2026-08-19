/// <reference types="vite/client" />

// Empty on purpose: the OAuth client id and secret are the Worker's business now (the browser
// only ever navigates to /api/auth/google/start), so the frontend build takes no auth config.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
