/**
 * [98.4.03] What the sign-in card leaves for the two-step set-up wizard (#3760) after the
 * new-owner codes pass. sessionStorage, never the URL: the URL is logged (Rule 13) and the
 * secret must not travel in it. The wizard reads it once and calls `clearEnrolHandoff()`.
 *
 * Contract for the wizard route (#3760): it lives OUTSIDE `_platform` (the owner has no session yet;
 * `__root.tsx` lists the path as public), works from the hand-off alone, shows "start again"
 * (link to `/sign-in`) when `readEnrolHandoff()` is null, and clears it after reading.
 * ponytail: tab-scoped storage is enough; no server-side hand-off until a second tab matters.
 */
export interface EnrolHandoff {
  enrolToken: string;
  otpauthUri: string;
  secret: string;
  rememberDevice: boolean;
}

const KEY = 'cockpit-enrol-handoff';

export function saveEnrolHandoff(value: EnrolHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // storage blocked: the wizard shows its "start again" state
  }
}

export function readEnrolHandoff(): EnrolHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EnrolHandoff) : null;
  } catch {
    return null;
  }
}

export function clearEnrolHandoff(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
