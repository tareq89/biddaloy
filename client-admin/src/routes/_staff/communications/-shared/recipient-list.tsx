import type { ReminderPreviewRecipient } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';

import { skipReasonKey } from './skip-reason';
import { SmsSegmentCounter } from './sms-segment-counter';

/** `guardian_name`/`guardian_id` are nullable to fit both shapes on the
 * wire: the single-preview `SkippedGuardianDto` always has both, but the
 * bulk preview's student-level skips (`no_open_dues`, `no_guardians`)
 * carry neither — this component serves both pages. */
export interface SkippedEntry {
  guardian_id: string | null;
  guardian_name: string | null;
  reason: string;
}

export interface RecipientListProps {
  recipients: ReminderPreviewRecipient[];
  skipped: SkippedEntry[];
}

/**
 * The preview result both reminder flows render — resolved recipients
 * with the *fully rendered* message each guardian will receive, and the
 * skipped list with a plain-language reason. The skipped half is not an
 * afterthought: a guardian silently dropped ("no phone on file") is the
 * failure mode the issue names, so it gets the same list treatment as
 * the recipients. A plain list (not a table) because each row carries a
 * long message body and must read the same on a phone.
 */
export function RecipientList({ recipients, skipped }: RecipientListProps) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('recipientList.recipientsTitle', { count: recipients.length })}>
        <h3 className="text-h3">
          {t('recipientList.recipientsTitle', { count: recipients.length })}
        </h3>
        {recipients.length === 0 ? (
          <p role="alert" className="mt-2 flex items-center gap-1 text-caption text-destructive">
            {t('recipientList.emptyRecipients')}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {recipients.map((recipient) => (
              <li key={`${recipient.guardian_id}-${recipient.medium}`} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium">{recipient.guardian_name}</p>
                  <p className="text-text-secondary">
                    {t(`mediums.${recipient.medium}`)} ·{' '}
                    {recipient.medium === 'EMAIL'
                      ? recipient.address
                      : formatPhone(recipient.address, config)}
                  </p>
                </div>
                {recipient.subject !== null && (
                  <p className="mt-2 font-medium">
                    {t('recipientList.subjectHeader')}: {recipient.subject}
                  </p>
                )}
                <p className="mt-2 rounded-md bg-muted p-3 whitespace-pre-wrap">
                  {recipient.message_body}
                </p>
                {/* The rendered body is what the network actually
                    charges for — count it here (not the raw template,
                    whose placeholders expand on send). Static row, so no
                    live region. */}
                {recipient.medium === 'SMS' && (
                  <div className="mt-1">
                    <SmsSegmentCounter text={recipient.message_body} live={false} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('recipientList.skippedTitle', { count: skipped.length })}>
        <h3 className="text-h3">{t('recipientList.skippedTitle', { count: skipped.length })}</h3>
        {skipped.length === 0 ? (
          <p className="mt-2 text-text-secondary">{t('recipientList.noneSkipped')}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {skipped.map((entry, index) => (
              <li
                key={entry.guardian_id ?? index}
                className="flex flex-col gap-0.5 py-3 md:flex-row md:justify-between md:gap-4"
              >
                <p className="font-medium">{entry.guardian_name ?? '—'}</p>
                <p className="text-text-secondary">{t(skipReasonKey(entry.reason))}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
