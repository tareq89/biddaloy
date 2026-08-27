import { CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';

/**
 * Guardian-selection and medium-dispatchability rules shared by the bulk
 * (#17) and single-student (#18) reminder flows, so both resolve "who gets
 * this message and on what channel" the same way rather than drifting.
 */

/**
 * Guardians a reminder about this student should go to by default.
 *
 * Primary contacts only when the student has any — a fee reminder sent to
 * both parents costs twice as much and reads as a duplicate. Students whose
 * guardians are all non-primary (common in partially-migrated data) fall
 * back to everyone linked, since silently sending nothing is worse.
 */
export function selectReminderGuardians(guardians: Guardian[]): Guardian[] {
  const primary = guardians.filter((g) => g.is_primary_contact);
  return primary.length > 0 ? primary : guardians;
}

/**
 * Splits guardians into those who still accept automated reminders and
 * those who have opted out (`notifications_enabled = false`). [5.4c]
 */
export function partitionByOptOut(guardians: Guardian[]): {
  reachable: Guardian[];
  optedOut: Guardian[];
} {
  const reachable: Guardian[] = [];
  const optedOut: Guardian[] = [];
  for (const guardian of guardians) {
    (guardian.notifications_enabled ? reachable : optedOut).push(guardian);
  }
  return { reachable, optedOut };
}

/**
 * The default reminder audience for one student, plus the opt-outs worth
 * telling the caller about.
 *
 * Two different questions are being asked of the same guardian list, and
 * conflating them is what over-reported skips: [5.4c]
 *
 * - **Who gets messaged** — selection runs over the *reachable* guardians
 *   only. That is what makes the promote-a-non-primary semantic work: if
 *   the sole primary contact has opted out, `selectReminderGuardians` sees
 *   a list without them, finds no primary, and falls back to the reachable
 *   non-primaries rather than leaving the student silent.
 * - **Who is reported as skipped** — only guardians who would actually
 *   have been chosen had they not opted out, i.e. the opt-outs that appear
 *   in `selectReminderGuardians(all linked)`. A non-primary who opted out
 *   while a reachable primary exists was never going to be messaged, so
 *   reporting them inflates `skipped_count` (and the audit row) with a
 *   non-event.
 *
 * Note the two selections are run over different lists on purpose; running
 * one and reusing it for both answers cannot express this.
 */
export function resolveReminderAudience(linked: Guardian[]): {
  guardians: Guardian[];
  skippedOptOut: Guardian[];
} {
  const { reachable, optedOut } = partitionByOptOut(linked);
  const wouldHaveBeenSelected = new Set(selectReminderGuardians(linked).map((g) => g.id));
  return {
    guardians: selectReminderGuardians(reachable),
    skippedOptOut: optedOut.filter((g) => wouldHaveBeenSelected.has(g.id)),
  };
}

/**
 * The address a given medium would actually dial or write to, or null when
 * the guardian has nothing on file for it.
 */
export function addressForMedium(guardian: Guardian, medium: CommunicationMedium): string | null {
  if (medium === CommunicationMedium.EMAIL) {
    return guardian.email || null;
  }
  return guardian.phone || guardian.alternate_phone || null;
}

/**
 * Media this system can actually dispatch to.
 *
 * PHONE_CALL has no automated provider by design, and MESSENGER can only
 * reach a page-scoped ID obtained after the guardian messages the school's
 * page first — neither is derivable from a phone number or email, so both
 * are skipped rather than queued into a guaranteed failure.
 */
export const DISPATCHABLE_MEDIA: CommunicationMedium[] = [
  CommunicationMedium.SMS,
  CommunicationMedium.WHATSAPP,
  CommunicationMedium.EMAIL,
];
