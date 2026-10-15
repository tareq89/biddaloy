/**
 * [58.4.02] The nightly sweep must still be signed in on every page it visits. The SPA keeps the
 * access token in memory only, so each `page.goto` restores the session from the refresh cookie; if
 * that fails the root guard redirects to `/login` (or the user lands on `/select-school`), and a
 * signed-out page has no error state to catch. Without this check a lost session passes the sweep.
 */
const SIGNED_OUT =
  /^\/(login|select-school|register|activate|forgot-password|reset-password|verify-email|auth\/social\/done)(\/|$)/;

/** The signed-out page `url` landed on (e.g. `/login`), or null while still signed in. */
export function signedOutAt(url: string): string | null {
  const path = new URL(url).pathname;
  return SIGNED_OUT.test(path) ? path : null;
}
