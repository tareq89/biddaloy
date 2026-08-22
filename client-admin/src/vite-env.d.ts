/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** [8.9.8]'s Sentry DSN — unset in local dev/CI, where `initSentry`
   * (`@biddaloy/ui/api`) no-ops. See its own comment. */
  readonly VITE_SENTRY_DSN?: string;
}
