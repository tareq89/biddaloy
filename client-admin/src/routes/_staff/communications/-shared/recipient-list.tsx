import type { ReminderPreviewRecipient } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

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
 * failure mode the issue names, so it gets the same table treatment as
 * the recipients.
 */
export function RecipientList({ recipients, skipped }: RecipientListProps) {
  const { t } = useTranslation('communications');

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('recipientList.recipientsTitle', { count: recipients.length })}>
        <h3 className="text-sm font-semibold">
          {t('recipientList.recipientsTitle', { count: recipients.length })}
        </h3>
        {recipients.length === 0 ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {t('recipientList.emptyRecipients')}
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('recipientList.guardianHeader')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('recipientList.channelHeader')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('recipientList.addressHeader')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('recipientList.messageHeader')}
                </th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => (
                <tr
                  key={`${recipient.guardian_id}-${recipient.medium}`}
                  className="border-b border-border align-top"
                >
                  <td className="py-2 pr-3">{recipient.guardian_name}</td>
                  <td className="py-2 pr-3">{t(`mediums.${recipient.medium}`)}</td>
                  <td className="py-2 pr-3">{recipient.address}</td>
                  <td className="py-2">
                    {recipient.subject !== null && (
                      <p className="font-medium">
                        {t('recipientList.subjectHeader')}: {recipient.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{recipient.message_body}</p>
                    {/* The rendered body is what the network actually
                        charges for — count it here (not the raw
                        template, whose placeholders expand on send).
                        Static row, so no live region. */}
                    {recipient.medium === 'SMS' && (
                      <SmsSegmentCounter text={recipient.message_body} live={false} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label={t('recipientList.skippedTitle', { count: skipped.length })}>
        <h3 className="text-sm font-semibold">
          {t('recipientList.skippedTitle', { count: skipped.length })}
        </h3>
        {skipped.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('recipientList.noneSkipped')}</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('recipientList.guardianHeader')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('recipientList.reasonHeader')}
                </th>
              </tr>
            </thead>
            <tbody>
              {skipped.map((entry, index) => {
                const reasonKey = skipReasonKey(entry.reason);
                return (
                  <tr key={entry.guardian_id ?? index} className="border-b border-border">
                    <td className="py-2 pr-3">{entry.guardian_name ?? '—'}</td>
                    {/* Unknown reason: show the raw wire string rather than
                        nothing — never leave a skip unexplained. */}
                    <td className="py-2">
                      {reasonKey !== undefined ? t(reasonKey) : entry.reason}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
