/**
 * [15.8] Barrel for this package's PWA-install surface. Deliberately its
 * own export condition (`@biddaloy/ui/pwa`, see `ui/package.json`) rather
 * than folded into `./components` or `./hooks` — `listen()` has to run
 * once, at app boot, before anything else in `ui/` (see
 * `install-prompt-store.ts`'s header comment), which makes it a different
 * kind of import site than the rest of those barrels.
 */
export {
  listen as installPromptListen,
  type BeforeInstallPromptEvent,
} from './install-prompt-store';
export {
  useInstallPrompt,
  type InstallPromptMode,
  type UseInstallPromptResult,
} from './use-install-prompt';
export { IosInstallSheet, type IosInstallSheetProps } from './ios-install-sheet';
export { InstallHint, type InstallHintProps } from './install-hint';
