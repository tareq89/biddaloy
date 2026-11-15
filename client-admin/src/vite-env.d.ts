/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** `'true'` turns on MSW (`@biddaloy/ui/mocks`). [8.12.1]'s
   * `registerServiceWorker` reads it to stand down, so the PWA worker
   * never fights MSW's for the root scope. */
  readonly VITE_USE_MOCKS?: string;
  /** [44.2.01] GitBook base for the (?) help links; empty hides every (?) (E4, E12). */
  readonly VITE_HANDBOOK_URL?: string;
  /** [3329.3.01] Landing site base for the register terms and privacy links; empty = plain text. */
  readonly VITE_LANDING_URL?: string;
}
