/**
 * [15.8.2] Tells the UI whether an install action should exist, and
 * performs it. Reads `install-prompt-store.ts`'s module-level captured
 * `beforeinstallprompt` event via `useSyncExternalStore` — same shape as
 * `hooks/use-online.ts` — so this hook never registers its own listener
 * (that must happen before React mounts; see the store's header comment).
 */
import * as React from 'react';

import {
  consumeEvent,
  getSnapshot,
  subscribe,
  type InstallPromptSnapshot,
} from './install-prompt-store';

const HINT_DISMISSED_KEY = 'pwa-install-hint-dismissed';

export type InstallPromptMode = 'none' | 'prompt' | 'ios-instructions';

export interface UseInstallPromptResult {
  mode: InstallPromptMode;
  install(): Promise<'accepted' | 'dismissed'>;
  hintDismissed: boolean;
  dismissHint(): void;
}

function getServerSnapshot(): InstallPromptSnapshot {
  return { event: null, standalone: false };
}

/**
 * iOS never fires `beforeinstallprompt` — Safari on iPhone/iPad is the
 * one platform that needs a manual "Share → Add to Home Screen" set of
 * instructions instead of a native prompt. Modern iPadOS reports its
 * platform as "MacIntel" in `navigator.userAgent` (desktop-class UA
 * string), so a Mac-platform UA with more than one touch point is treated
 * as iPad too — a real Mac with a mouse reports `maxTouchPoints <= 1`.
 */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua);
  const isIpadOnMacUa = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (!isIosDevice && !isIpadOnMacUa) return false;
  // Exclude other iOS browsers, which all embed Safari's engine but
  // aren't Safari itself (CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge,
  // OPiOS = Opera) — none of them can trigger the native install flow
  // either, but this hook only owns the Safari-specific instructions.
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return /Safari/.test(ua) && !isOtherIosBrowser;
}

function readHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_DISMISSED_KEY) === 'true';
  } catch {
    // Private browsing, quota exceeded, storage disabled, or no `window`
    // (SSR) — never let a storage failure break the hook, just behave as
    // "not dismissed".
    return false;
  }
}

function writeHintDismissed(): void {
  try {
    window.localStorage.setItem(HINT_DISMISSED_KEY, 'true');
  } catch {
    // Same tolerance as the read above — dismissing the hint is a nicety,
    // not something worth throwing over.
  }
}

export function useInstallPrompt(): UseInstallPromptResult {
  const { event, standalone } = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [hintDismissed, setHintDismissed] = React.useState(readHintDismissed);

  const mode: InstallPromptMode = standalone
    ? 'none'
    : event
      ? 'prompt'
      : isIosSafari()
        ? 'ios-instructions'
        : 'none';

  const install = React.useCallback(async (): Promise<'accepted' | 'dismissed'> => {
    const capturedEvent = consumeEvent();
    if (!capturedEvent) return 'dismissed';
    await capturedEvent.prompt();
    const { outcome } = await capturedEvent.userChoice;
    return outcome;
  }, []);

  const dismissHint = React.useCallback(() => {
    writeHintDismissed();
    setHintDismissed(true);
  }, []);

  return { mode, install, hintDismissed, dismissHint };
}
