/**
 * "Never convey status by colour alone" stops being a guideline and
 * becomes a component here. Every status renders colour **plus text plus
 * a distinct icon shape** — verified in `status-badge.stories.tsx`'s
 * `Greyscale` story, which is what actually proves the shape carries the
 * meaning rather than trusting it by inspection.
 *
 * Colour/icon pairs for `success`/`info`/`warning`/`danger` reuse
 * `tailwind.preset.ts`'s `status` tokens (`paid`/`partial`/`due`/
 * `overdue`) — those names are fee-lifecycle-specific, but the same four
 * tones cover every domain this badge handles (a "delivered" message and
 * a "paid" fee are both a `success`). `neutral` is this component's own
 * fifth tone for terminal/inactive states (`DRAFT`, `CANCELLED`,
 * `WAIVED`, ...) that don't fit the fee lifecycle's tones at all.
 *
 * One `StatusBadge` covers every domain via a discriminated union on
 * `domain` — passing a `FeeStatus` value with `domain="payment"` is a
 * type error, not a runtime mismatch. Most domains are `shared/src/enums`
 * lifecycles; `academicYear` and `guardian` are plain-boolean exceptions
 * (see their own comments below).
 */
import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
  UserStatus,
} from '@biddaloy/shared';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, MinusCircle } from 'lucide-react';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const TONE_STYLES: Record<
  StatusTone,
  { fg: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: { fg: 'text-status-paid-fg', bg: 'bg-status-paid-bg', icon: CheckCircle2 },
  info: { fg: 'text-status-partial-fg', bg: 'bg-status-partial-bg', icon: CircleDashed },
  warning: { fg: 'text-status-due-fg', bg: 'bg-status-due-bg', icon: Clock },
  danger: { fg: 'text-status-overdue-fg', bg: 'bg-status-overdue-bg', icon: AlertTriangle },
  neutral: { fg: 'text-muted-foreground', bg: 'bg-muted', icon: MinusCircle },
};

/** Title-cases an enum key ("PARTIALLY_PAID" -> "Partially paid") — not
 * real i18n, just a readable fallback until a translated-label lookup
 * replaces it (see `ui/CONTRIBUTING.md`'s "i18n rules" section for why
 * i18next landing in [8.7.1] didn't close this on its own). There's no
 * prop to override the derived label today — nothing should come to
 * depend on these English strings as if they were stable.
 *
 * Exported as `humanizeStatus` so callers rendering a status outside a
 * `StatusBadge` (a `<SelectItem>` filter option, a CSV cell, ...) show
 * the same label this component does instead of the raw enum value. */
export function humanizeStatus(key: string): string {
  const lower = key.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const FEE_STATUS_TONE: Record<FeeStatus, StatusTone> = {
  [FeeStatus.PENDING]: 'warning',
  [FeeStatus.PARTIALLY_PAID]: 'info',
  [FeeStatus.PAID]: 'success',
  [FeeStatus.OVERDUE]: 'danger',
  [FeeStatus.WAIVED]: 'neutral',
  [FeeStatus.ADVANCE]: 'info',
};

const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  [PaymentStatus.SUCCESS]: 'success',
  [PaymentStatus.PENDING]: 'warning',
  [PaymentStatus.FAILED]: 'danger',
  [PaymentStatus.REFUNDED]: 'neutral',
};

const INVOICE_STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  [InvoiceStatus.DRAFT]: 'neutral',
  [InvoiceStatus.ISSUED]: 'info',
  [InvoiceStatus.PAID]: 'success',
  [InvoiceStatus.CANCELLED]: 'neutral',
  [InvoiceStatus.OVERDUE]: 'danger',
};

/** Accepts the plain literal union too (`\`${CommunicationStatus}\``) —
 * [8.11.9]'s callers hold `schema.d.ts`'s string literals (a
 * `CommunicationResponseDto.status`, a sent-reminder recipient's
 * `status`), not the shared enum object. Same shape as `UserStatusValue`
 * below. */
type CommunicationStatusValue = `${CommunicationStatus}`;

const COMMUNICATION_STATUS_TONE: Record<CommunicationStatusValue, StatusTone> = {
  [CommunicationStatus.QUEUED]: 'neutral',
  [CommunicationStatus.SENT]: 'info',
  [CommunicationStatus.DELIVERED]: 'info',
  [CommunicationStatus.FAILED]: 'danger',
  [CommunicationStatus.READ]: 'success',
};

const REMINDER_BATCH_STATUS_TONE: Record<ReminderBatchStatus, StatusTone> = {
  [ReminderBatchStatus.PROCESSING]: 'info',
  [ReminderBatchStatus.COMPLETED]: 'success',
  [ReminderBatchStatus.PARTIALLY_FAILED]: 'warning',
  [ReminderBatchStatus.FAILED]: 'danger',
};

const ENROLLMENT_STATUS_TONE: Record<EnrollmentStatus, StatusTone> = {
  [EnrollmentStatus.ACTIVE]: 'success',
  [EnrollmentStatus.INACTIVE]: 'neutral',
  [EnrollmentStatus.TRANSFERRED]: 'info',
  [EnrollmentStatus.GRADUATED]: 'success',
};

/** Not a `shared/src/enums` domain — `AcademicYear.is_current` is a plain
 * boolean, not a lifecycle enum. [8.11.1]'s "is_current visually distinct
 * without relying on colour alone" AC is exactly what this component
 * already guarantees for every other domain, so it's added as one more
 * domain here rather than a bespoke boolean pill. */
export type AcademicYearCurrentStatus = 'CURRENT' | 'NOT_CURRENT';

const ACADEMIC_YEAR_STATUS_TONE: Record<AcademicYearCurrentStatus, StatusTone> = {
  CURRENT: 'success',
  NOT_CURRENT: 'neutral',
};

/** Not a `shared/src/enums` domain either — `Guardian.is_primary_contact`
 * is a plain boolean, same shape as `AcademicYearCurrentStatus` above.
 * [8.11.4]'s "primary-contact status clearly indicated without relying on
 * colour" AC is exactly what this component already guarantees for every
 * other domain. */
export type GuardianPrimaryContactStatus = 'PRIMARY' | 'SECONDARY';

const GUARDIAN_STATUS_TONE: Record<GuardianPrimaryContactStatus, StatusTone> = {
  PRIMARY: 'success',
  SECONDARY: 'neutral',
};

/** Not a `shared/src/enums` domain either — `FeeStructure.is_recurring` is
 * a plain boolean, same shape as the two booleans above. [8.11.5]'s
 * "recurring structures visually distinguished without relying on colour"
 * AC is exactly what this component already guarantees: the label text
 * ("Recurring" vs "One time") carries the meaning, tone only decorates. */
export type FeeStructureRecurrenceStatus = 'RECURRING' | 'ONE_TIME';

const FEE_STRUCTURE_STATUS_TONE: Record<FeeStructureRecurrenceStatus, StatusTone> = {
  RECURRING: 'info',
  ONE_TIME: 'neutral',
};

/** [8.11.8]'s staff list/detail — `UserStatus` is a real
 * `shared/src/enums` lifecycle (`user.entity.ts`'s `status` column), read
 * -only in the UI (no activate/deactivate endpoint exists). `SUSPENDED`
 * is `warning` rather than `danger`: it's an administrative hold, not a
 * failure state. Text label + icon shape carry the meaning, per this
 * component's greyscale guarantee. */
/** Accepts the plain literal union too (`\`${UserStatus}\``) — callers
 * hold `schema.d.ts`'s string literals, not the shared enum object. */
type UserStatusValue = `${UserStatus}`;

const USER_STATUS_TONE: Record<UserStatusValue, StatusTone> = {
  [UserStatus.ACTIVE]: 'success',
  [UserStatus.INACTIVE]: 'neutral',
  [UserStatus.SUSPENDED]: 'warning',
};

export type StatusBadgeProps =
  | { domain: 'fee'; status: FeeStatus }
  | { domain: 'payment'; status: PaymentStatus }
  | { domain: 'invoice'; status: InvoiceStatus }
  | { domain: 'communication'; status: CommunicationStatusValue }
  | { domain: 'reminderBatch'; status: ReminderBatchStatus }
  | { domain: 'enrollment'; status: EnrollmentStatus }
  | { domain: 'academicYear'; status: AcademicYearCurrentStatus }
  | { domain: 'guardian'; status: GuardianPrimaryContactStatus }
  | { domain: 'feeStructure'; status: FeeStructureRecurrenceStatus }
  | { domain: 'user'; status: UserStatusValue };

function resolveTone(props: StatusBadgeProps): StatusTone {
  switch (props.domain) {
    case 'fee':
      return FEE_STATUS_TONE[props.status];
    case 'payment':
      return PAYMENT_STATUS_TONE[props.status];
    case 'invoice':
      return INVOICE_STATUS_TONE[props.status];
    case 'communication':
      return COMMUNICATION_STATUS_TONE[props.status];
    case 'reminderBatch':
      return REMINDER_BATCH_STATUS_TONE[props.status];
    case 'enrollment':
      return ENROLLMENT_STATUS_TONE[props.status];
    case 'academicYear':
      return ACADEMIC_YEAR_STATUS_TONE[props.status];
    case 'guardian':
      return GUARDIAN_STATUS_TONE[props.status];
    case 'feeStructure':
      return FEE_STRUCTURE_STATUS_TONE[props.status];
    case 'user':
      return USER_STATUS_TONE[props.status];
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const tone = resolveTone(props);
  const { fg, bg, icon: Icon } = TONE_STYLES[tone];
  const label = humanizeStatus(props.status);

  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        fg,
        bg,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
