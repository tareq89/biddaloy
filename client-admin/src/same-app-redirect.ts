/**
 * A `?redirect=` value is only followed when it stays inside this app.
 *
 * `value.startsWith('/')` alone isn't enough: browsers resolve a leading `\`
 * the same as `/` (WHATWG URL spec), so `/\evil.com` and `//evil.com` both
 * resolve off-origin despite starting with a single `/`. Checking the
 * *resolved* origin against a fixed, non-routable probe base catches both,
 * and keeps this a pure function testable without a browser.
 *
 * Shared by `/login`, `/select-school` and `/auth/social/done`.
 */
const REDIRECT_PROBE_ORIGIN = 'http://redirect-probe.invalid';

export function isSameAppRedirect(value: string): boolean {
  if (!value.startsWith('/')) return false;
  try {
    return new URL(value, REDIRECT_PROBE_ORIGIN).origin === REDIRECT_PROBE_ORIGIN;
  } catch {
    return false;
  }
}
