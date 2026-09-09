/**
 * [15.7.6] Dismiss state for the one-time push opt-in card
 * (`../components/push-opt-in-card.tsx`) — a plain `localStorage` flag,
 * wrapped in try/catch per #557's own acceptance criterion (a private
 * window, disabled storage, or a full quota must not throw and break the
 * page the card sits on top of).
 *
 * Scoped by caller-supplied `userId` — this browser's `localStorage` is
 * shared by every account that ever signs in on it. Without the scope, one
 * guardian dismissing the card would suppress the opt-in prompt for the
 * next guardian who signs in on the same device.
 */
const STORAGE_KEY_PREFIX = 'biddaloy:push-opt-in-dismissed:';

export function isPushOptInDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

export function dismissPushOptIn(userId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + userId, '1');
  } catch {
    // Best-effort only — a viewer with storage blocked just sees the
    // card again next time, which is a mild annoyance, not a bug worth
    // surfacing.
  }
}
