/**
 * [48.3.B-01] Which certificate kinds a student can be offered (step 1). Pure: the server
 * re-checks at issue time (409 CERTIFICATE_NOT_ELIGIBLE); this only explains a disabled card.
 */
import { DocumentKind, EnrollmentStatus } from '@biddaloy/shared';

export type KindRefusal =
  'NO_LEAVING_EVENT' | 'NOT_CURRENT' | 'NOT_CURRENT_OR_GRADUATED' | 'NO_TEMPLATE';

export type KindAvailability = { ok: true } | { ok: false; reason: KindRefusal };

export interface LifecycleEventLike {
  event_type: string;
  occurred_on: string;
  created_at?: string;
}

/** The latest event decides: a later READMITTED cancels an earlier leaving (D4). */
export function hasLeavingEvent(events: readonly LifecycleEventLike[]): boolean {
  const sorted = [...events].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
  const latest = sorted[sorted.length - 1];
  return latest?.event_type === 'TRANSFERRED_OUT' || latest?.event_type === 'WITHDRAWN';
}

export function kindAvailability(
  kind: DocumentKind,
  ctx: {
    enrollmentStatus: string;
    events: readonly LifecycleEventLike[];
    hasTemplate: boolean;
  },
): KindAvailability {
  const status = ctx.enrollmentStatus as EnrollmentStatus;
  const active = status === EnrollmentStatus.ACTIVE;
  if (kind === DocumentKind.TRANSFER_CERTIFICATE && !hasLeavingEvent(ctx.events)) {
    return { ok: false, reason: 'NO_LEAVING_EVENT' };
  }
  if (kind === DocumentKind.TESTIMONIAL && !active && status !== EnrollmentStatus.GRADUATED) {
    return { ok: false, reason: 'NOT_CURRENT_OR_GRADUATED' };
  }
  if (kind === DocumentKind.STUDY_CERTIFICATE && !active) {
    return { ok: false, reason: 'NOT_CURRENT' };
  }
  return ctx.hasTemplate ? { ok: true } : { ok: false, reason: 'NO_TEMPLATE' };
}
