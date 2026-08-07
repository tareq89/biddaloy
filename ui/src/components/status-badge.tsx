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
 * One `StatusBadge` covers all six domains from `shared/src/enums` via a
 * discriminated union on `domain` — passing a `FeeStatus` value with
 * `domain="payment"` is a type error, not a runtime mismatch.
 */
import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
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
 * real i18n, just a readable fallback, deliberately: `ui`'s wrapper layer
 * originates translation keys rather than consuming them (see
 * `ui/CONTRIBUTING.md`'s "i18n rules" section), so this stays a plain
 * label derivation rather than a `t()` call. There's no prop to override
 * the derived label today — nothing should come to depend on these
 * English strings as if they were stable; a later ticket that wants a
 * translated status label needs to add one rather than assume this stays
 * English forever. */
function humanize(key: string): string {
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

const COMMUNICATION_STATUS_TONE: Record<CommunicationStatus, StatusTone> = {
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

export type StatusBadgeProps =
  | { domain: 'fee'; status: FeeStatus }
  | { domain: 'payment'; status: PaymentStatus }
  | { domain: 'invoice'; status: InvoiceStatus }
  | { domain: 'communication'; status: CommunicationStatus }
  | { domain: 'reminderBatch'; status: ReminderBatchStatus }
  | { domain: 'enrollment'; status: EnrollmentStatus };

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
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const tone = resolveTone(props);
  const { fg, bg, icon: Icon } = TONE_STYLES[tone];
  const label = humanize(props.status);

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
