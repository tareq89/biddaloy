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
