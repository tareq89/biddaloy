/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** `'true'` turns on MSW (`@biddaloy/ui/mocks`). [8.12.1]'s
   * `registerServiceWorker` reads it to stand down, so the PWA worker
   * never fights MSW's for the root scope. */
  readonly VITE_USE_MOCKS?: string;
}
