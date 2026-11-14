import type { ActionLineDto } from '@biddaloy/shared';
import {
  ActionLinesCard,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  type ActionLine,
} from '@biddaloy/ui/components';
import type { SmsStateReport, SmsStateTotals } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import { AlertTriangleIcon } from 'lucide-react';
import * as React from 'react';

import { SchoolSmsList, type SchoolSmsListProps } from './school-sms-list';

/** D12: what to do, then the numbers, then profit per package, then the schools. No filter. */
export interface SmsStateViewProps {
  report: SmsStateReport | undefined;
  loading: boolean;
  error?: string | undefined;
  onRetry: () => void;
  /** One action line was pressed (the server's own order is kept). */
  onAction: (line: ActionLineDto) => void;
  onOpenSchool: SchoolSmsListProps['onOpen'];
  onCsv: () => void;
  csvError?: string | undefined;
  /** More schools come after this page. */
  onNext?: (() => void) | undefined;
  /** The "record SMS bought" slot (#3885), mounted by the route. */
  stockSlot?: React.ReactNode;
  layout?: SchoolSmsListProps['layout'];
}

const MONEY_KEYS = ['revenuePaisa', 'costPaisa', 'marginPaisa'] as const;
const SMS_KEYS = [
  'boughtSms',
  'soldSms',
  'usedSms',
  'expiredSms',
  'promisedUnusedSms',
  'unsoldSms',
] as const;

export function SmsStateView({
  report,
  loading,
  error,
  onRetry,
  onAction,
  onOpenSchool,
  onCsv,
  csvError,
  onNext,
  stockSlot,
  layout,
}: SmsStateViewProps) {
  const { t } = useTranslation('money');
  const config = useRegionConfig();
  const num = (v: number) => formatNumber(v, config);

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} retryLabel={t('sms.retry')} />;
  }
  if (loading || !report) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const lines: ActionLine[] = report.actionLines.map((line) => ({
    id: line.code,
    tone: line.tone,
    text: t(`sms.lines.${line.code}.text`, {
      ...(line.params['sms'] !== undefined ? { sms: num(Number(line.params['sms'])) } : {}),
      ...(line.params['count'] !== undefined ? { count: num(Number(line.params['count'])) } : {}),
      ...(line.params['days'] !== undefined ? { days: num(Number(line.params['days'])) } : {}),
    }),
    action: { label: t(`sms.lines.${line.code}.action`), onClick: () => onAction(line) },
  }));

  const { balance, totals } = report;
  const unsure = balance.stale || balance.kind === 'UNKNOWN';
  const noSales = totals.soldSms === 0 && report.schools.length === 0;
  const value = (k: keyof SmsStateTotals) =>
    (MONEY_KEYS as readonly string[]).includes(k)
      ? formatCurrency(totals[k], config)
      : num(totals[k]);

  return (
    <div className="flex flex-col gap-4">
      <ActionLinesCard title={t('sms.todoTitle')} lines={lines} emptyText={t('sms.todoEmpty')} />

      {unsure && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-sm text-status-due-fg"
        >
          <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {balance.kind === 'UNKNOWN' ? t('sms.balanceUnknown') : t('sms.balanceStale')}
        </p>
      )}
      {balance.sms !== null && (
        <p className="text-sm text-text-secondary">
          {t('sms.balanceNow', { sms: num(balance.sms) })}
        </p>
      )}

      {stockSlot}

      {noSales ? (
        <EmptyState
          title={t('sms.emptyTitle')}
          explanation={t('sms.emptyText')}
          kind="no-results"
        />
      ) : (
        <>
          <Card padded>
            <h2 className="text-base font-semibold text-text-primary">{t('sms.numbersTitle')}</h2>
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...SMS_KEYS, ...MONEY_KEYS].map((k) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-text-secondary">{t(`sms.numbers.${k}`)}</dt>
                  <dd className="text-base font-semibold text-text-primary">{value(k)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {report.packages.length > 0 && (
            <Card padded>
              <h2 className="text-base font-semibold text-text-primary">
                {t('sms.packagesTitle')}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {report.packages.map((p) => (
                  <li key={p.catalogId} className="text-sm">
                    <span className="block font-medium text-text-primary">{p.name}</span>
                    <span className="text-text-secondary">
                      {t('sms.packageLine', {
                        orders: num(p.orders),
                        sold: num(p.soldSms),
                        revenue: formatCurrency(p.revenuePaisa, config),
                        cost: formatCurrency(p.costPaisa, config),
                        margin: formatCurrency(p.marginPaisa, config),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <section aria-labelledby="sms-schools-title" className="flex flex-col gap-3">
            <h2 id="sms-schools-title" className="text-base font-semibold text-text-primary">
              {t('sms.schoolsTitle')}
            </h2>
            <SchoolSmsList
              schools={report.schools}
              onOpen={onOpenSchool}
              {...(layout ? { layout } : {})}
            />
            {onNext && report.nextCursor && (
              <Button variant="outline" className="min-h-11 self-start md:min-h-0" onClick={onNext}>
                {t('sms.next')}
              </Button>
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-2">
        {csvError && (
          <p role="alert" className="text-sm text-status-overdue-fg">
            {csvError}
          </p>
        )}
        <Button variant="outline" className="min-h-11 self-start md:min-h-0" onClick={onCsv}>
          {t('sms.csv')}
        </Button>
      </div>
    </div>
  );
}
