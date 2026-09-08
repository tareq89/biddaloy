import { countSmsSegments, CommunicationMedium } from '@biddaloy/shared';
import { renderReminderTemplate, ReminderTemplateVars } from './reminder-template.util';

/**
 * Anything with a dispatch medium and the vars to render its message —
 * `ResolvedRecipient` from reminders.service.ts satisfies this, and so
 * will single-reminder.service.ts's equivalent, without either importing
 * the other's type.
 */
export interface SmsProjectableRecipient {
  medium: CommunicationMedium;
  vars: ReminderTemplateVars;
}

export interface SmsUnitsProjection {
  sms_recipients: number;
  sms_units: number;
}

/**
 * [15.6.4/#547] The exact SMS units a bulk send would reserve, computed by
 * rendering EACH recipient's message individually and summing
 * `countSmsSegments(rendered).segments` — never `count * segments-of-one`.
 * Two recipients' placeholders can push one message into GSM-7 and the
 * other into UCS-2 (Bengali), which changes the per-message segment size,
 * so the sum only equals the naive product by coincidence.
 *
 * Reused verbatim by the send path (#548) with the same
 * `recipients`/`template` so the projection this shows in preview is
 * exactly what the reservation later takes.
 *
 * Only SMS recipients count — email/WhatsApp/push/etc. dispatch through
 * their own providers and never touch the SMS credit ledger.
 */
export function projectSmsUnits(
  recipients: SmsProjectableRecipient[],
  template: string,
): SmsUnitsProjection {
  let sms_recipients = 0;
  let sms_units = 0;

  for (const recipient of recipients) {
    if (recipient.medium !== CommunicationMedium.SMS) continue;
    const rendered = renderReminderTemplate(template, recipient.vars);
    sms_units += countSmsSegments(rendered).segments;
    sms_recipients++;
  }

  return { sms_recipients, sms_units };
}
