/**
 * [98.4.03] What the sign-in card leaves for the two-step set-up wizard (#3760) after the
 * new-owner codes pass. module memory, never the URL or web storage: the URL is logged (Rule 13) and the
 * secret must not travel in it. The wizard reads it once and calls `clearEnrolHandoff()`.
 *
 * Contract for the wizard route (#3760): it lives OUTSIDE `_platform` (the owner has no session yet;
 * `__root.tsx` lists the path as public), works from the hand-off alone, shows "start again"
 * (link to `/sign-in`) when `readEnrolHandoff()` is null, and clears it after reading.
 * ponytail: in-memory only; no server-side hand-off until a reload mid-wizard matters.
 */
export interface EnrolHandoff {
  enrolToken: string;
  otpauthUri: string;
  secret: string;
  rememberDevice: boolean;
}

// Memory only: CodeQL flags the secret as clear text in web storage. A reload drops it and the
// wizard shows "start again".
let current: EnrolHandoff | null = null;

export function saveEnrolHandoff(value: EnrolHandoff): void {
  current = value;
}

export function readEnrolHandoff(): EnrolHandoff | null {
  return current;
}

export function clearEnrolHandoff(): void {
  current = null;
}
