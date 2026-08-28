/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** [8.9.8]'s Sentry DSN — unset in local dev/CI, where `initSentry`
   * (`@biddaloy/ui/api`) no-ops. See its own comment. */
  readonly VITE_SENTRY_DSN?: string;
  /** [8.12.7]: fraction of transactions (and so of Web Vitals samples)
   * sent, as a string such as `'0.1'`. Unset, non-numeric or outside
   * `[0, 1]` — `initSentry` falls back to its own 0.1 default, so a
   * typo'd `10` cannot mean "send everything". */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  /** `'true'` turns on MSW (`@biddaloy/ui/mocks`). [8.12.1]'s
   * `registerServiceWorker` reads it to stand down, so the PWA worker
   * never fights MSW's for the root scope. */
  readonly VITE_USE_MOCKS?: string;
}
