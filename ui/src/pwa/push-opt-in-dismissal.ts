/**
 * [15.7.6] Dismiss state for the one-time push opt-in card
 * (`../components/push-opt-in-card.tsx`) — a plain `localStorage` flag,
 * wrapped in try/catch per #557's own acceptance criterion (a private
 * window, disabled storage, or a full quota must not throw and break the
 * page the card sits on top of).
 */
const STORAGE_KEY = 'biddaloy:push-opt-in-dismissed';

export function isPushOptInDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissPushOptIn(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best-effort only — a viewer with storage blocked just sees the
    // card again next time, which is a mild annoyance, not a bug worth
    // surfacing.
  }
}
