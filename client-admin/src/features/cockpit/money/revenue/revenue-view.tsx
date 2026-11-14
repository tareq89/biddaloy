/**
 * #3889 Revenue tab: pick a month, read what came in, refunds taken off, and who did not renew.
 * Presentational: the route owns the month (URL), the query, the CSV call and the VAT dialog.
 *
 * ```
 *  Revenue            [Month v] [Download CSV] [VAT on receipts]
 *  From seats  From SMS packages  Refunds taken off  Total  Paying schools
 *  Did not renew: school | ended on | days ago | plan | Open billing
 * ```
 */
import { Button, ErrorState, MonthPicker, Skeleton } from '@biddaloy/ui/components';
import type { PlatformRevenueReport } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';

import { NotRenewedList } from './not-renewed-list';

export interface RevenueViewProps {
  month: string;
  onMonthChange: (month: string) => void;
  report?: PlatformRevenueReport | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onCsv: () => void;
  csvError?: boolean;
  onVat: () => void;
  /** More not-renewed schools on the next page. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
}

export function RevenueView(props: RevenueViewProps) {
  const { report, loading, error } = props;
  const { t } = useTranslation('moneyRevenue');
  const config = useRegionConfig();
  const money = (paisa: number) => formatCurrency(paisa, config);

  const numbers = report
    ? [
        ['seats', money(report.seat_income_paisa)],
        ['packages', money(report.package_income_paisa)],
        // Refunds are already inside `net_paisa`: shown as a minus line, never added again.
        ['refunds', report.refunds_paisa > 0 ? `-${money(report.refunds_paisa)}` : money(0)],
        ['total', money(report.net_paisa)],
        ['schools', formatNumber(report.paying_schools, config)],
      ]
    : [];

  return (
    <section aria-labelledby="revenue-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="revenue-title" className="text-heading-3 font-semibold">
          {t('title')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={props.month}
            onValueChange={props.onMonthChange}
            aria-label={t('month')}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 md:min-h-0"
            onClick={props.onCsv}
          >
            {t('csv')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 md:min-h-0"
            onClick={props.onVat}
          >
            {t('vatButton')}
          </Button>
        </div>
      </div>
      {props.csvError && (
        <p role="alert" className="text-caption text-destructive">
          {t('csvError')}
        </p>
      )}
      {error ? (
        <ErrorState message={t('loadError')} onRetry={props.onRetry} retryLabel={t('retry')} />
      ) : loading || !report ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {numbers.map(([id, value]) => (
              <div key={id} className="rounded-md border border-border-functional bg-surface p-3">
                <dt className="text-caption text-text-secondary">{t(`numbers.${id}`)}</dt>
                <dd className="text-heading-3 font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="text-heading-4 font-semibold">{t('notRenewed.title')}</h3>
          <p className="text-caption text-text-secondary">{t('notRenewed.note')}</p>
          <NotRenewedList rows={report.not_renewed.items} />
          {props.hasMore && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 justify-self-start md:min-h-0"
              loading={props.loadingMore ?? false}
              onClick={props.onMore}
            >
              {t('notRenewed.more')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
