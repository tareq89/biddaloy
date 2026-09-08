/**
 * [15.6.8/#551] The bulk wizard's review-step SMS projection —
 * recipients, units, and (only under `PLATFORM` metering) the available
 * balance plus a shortfall warning. Extracted from `bulk-reminder-wizard.tsx`
 * into its own presentational component so Storybook can cover OFF/
 * sufficient/short without wiring the whole wizard's preview mutation.
 */
import type { BulkReminderPreview } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface BulkSmsProjectionCardProps {
  projection: BulkReminderPreview['projection'];
}

export function BulkSmsProjectionCard({ projection }: BulkSmsProjectionCardProps) {
  const { t } = useTranslation('communications');
  const creditBlocked = projection.metering === 'PLATFORM' && (projection.shortfall ?? 0) > 0;

  return (
    <div
      aria-label={t('bulk.review.projection.title')}
      className="rounded-md border border-border-subtle p-3"
    >
      <h2 className="text-sm font-semibold">{t('bulk.review.projection.title')}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t('bulk.review.projection.recipients')}</dt>
          <dd className="tabular-nums">{projection.sms_recipients}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('bulk.review.projection.units')}</dt>
          <dd className="tabular-nums">{projection.sms_units}</dd>
        </div>
        {projection.metering === 'PLATFORM' && (
          <div>
            <dt className="text-muted-foreground">{t('bulk.review.projection.available')}</dt>
            <dd className="tabular-nums">{projection.available}</dd>
          </div>
        )}
      </dl>
      {creditBlocked && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t('bulk.review.projection.shortfall', {
            shortfall: projection.shortfall,
            available: projection.available,
            required: projection.sms_units,
          })}
        </p>
      )}
    </div>
  );
}
