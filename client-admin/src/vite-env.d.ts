/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** [8.9.8]'s Sentry DSN — unset in local dev/CI, where `initSentry`
   * (`@biddaloy/ui/api`) no-ops. See its own comment. */
  readonly VITE_SENTRY_DSN?: string;
  /** `'true'` turns on MSW (`@biddaloy/ui/mocks`). [8.12.1]'s
   * `registerServiceWorker` reads it to stand down, so the PWA worker
   * never fights MSW's for the root scope. */
  readonly VITE_USE_MOCKS?: string;
}
