/**
 * [15.6.8/#551] The bulk wizard's review-step SMS projection —
 * recipients, units, and (only under `PLATFORM` metering) the available
 * balance plus a shortfall warning. Extracted from `bulk-reminder-wizard.tsx`
 * into its own presentational component so Storybook can cover OFF/
 * sufficient/short without wiring the whole wizard's preview mutation.
 */
import { Card } from '@biddaloy/ui/components';
import type { BulkReminderPreview } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';

export interface BulkSmsProjectionCardProps {
  projection: BulkReminderPreview['projection'];
}

export function BulkSmsProjectionCard({ projection }: BulkSmsProjectionCardProps) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const creditBlocked = projection.metering === 'PLATFORM' && (projection.shortfall ?? 0) > 0;

  return (
    <Card padded aria-label={t('bulk.review.projection.title')}>
      <h3 className="text-h3">{t('bulk.review.projection.title')}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-secondary">
            {t('bulk.review.projection.recipients')}
          </dt>
          <dd className="font-medium tabular-nums">
            {formatNumber(projection.sms_recipients, config)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">{t('bulk.review.projection.units')}</dt>
          <dd className="font-medium tabular-nums">{formatNumber(projection.sms_units, config)}</dd>
        </div>
        {projection.metering === 'PLATFORM' && (
          <div>
            <dt className="text-caption text-text-secondary">
              {t('bulk.review.projection.available')}
            </dt>
            <dd className="font-medium tabular-nums">
              {formatNumber(projection.available, config)}
            </dd>
          </div>
        )}
      </dl>
      {creditBlocked && (
        <p role="alert" className="mt-3 flex items-center gap-1 text-caption text-destructive">
          <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
          {t('bulk.review.projection.shortfall', {
            shortfall: formatNumber(projection.shortfall, config),
            available: formatNumber(projection.available, config),
            required: formatNumber(projection.sms_units, config),
          })}
        </p>
      )}
    </Card>
  );
}
