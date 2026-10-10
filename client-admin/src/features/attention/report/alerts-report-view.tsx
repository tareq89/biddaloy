/**
 * [67.5.06] The alerts report: month / rule / section filters (URL-synced), four
 * facts, a rule x section table and a CSV download. Composed like
 * `/reports/collections` (PageHeader + FilterBar + unpaginated DataTable); the
 * route file is 67.5.09.
 */
import { ALERT_RULES, AlertCategory } from '@biddaloy/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonTable,
  toast,
} from '@biddaloy/ui/components';
import {
  downloadAlertsReportCsv,
  useAlertsReport,
  type AlertsReportFilters,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  useListShellState,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatMonth, tenantTodayIso } from '@biddaloy/ui/utils';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { useSectionOptions } from '../use-section-options';

import { AlertsReportFacts } from './alerts-report-facts';
import { AlertsReportTable } from './alerts-report-table';

const MONTHS_BACK = 12;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rules a school can see in the report: no platform / manual / epic-owned ones (same set as Settings). */
const REPORT_RULES = ALERT_RULES.filter(
  (r) =>
    !r.ownerEpic && r.category !== AlertCategory.PLATFORM && r.category !== AlertCategory.MANUAL,
);

/** `"2026-10"` and the 12 months before it, newest first. */
function recentMonths(current: string): string[] {
  const [y = 0, m = 1] = current.split('-').map(Number);
  return Array.from({ length: MONTHS_BACK + 1 }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

export function AlertsReportView() {
  const { t } = useTranslation('attention');
  const config = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const sectionOptions = useSectionOptions();

  const currentMonth = tenantTodayIso(config).slice(0, 7);
  const months = recentMonths(currentMonth);
  const { month: rawMonth, rule: rawRule, section_id: sectionId } = state.filters;
  const month =
    rawMonth && MONTH_RE.test(rawMonth) && months.includes(rawMonth) ? rawMonth : currentMonth;
  const rule = REPORT_RULES.find((r) => r.key === rawRule)?.key;
  const filters = {
    month,
    ...(rule ? { ruleKey: rule } : {}),
    ...(sectionId ? { sectionId } : {}),
  } as AlertsReportFilters;

  const query = useAlertsReport(filters);
  const [csvBusy, setCsvBusy] = React.useState(false);
  async function downloadCsv() {
    setCsvBusy(true);
    try {
      await downloadAlertsReportCsv(filters);
    } catch {
      toast.error(t('status.error', { ns: 'common' }));
    } finally {
      setCsvBusy(false);
    }
  }

  const fields: FilterFieldDescriptor[] = [
    // ponytail: FilterBar has no month / combobox kind, so month and section are selects.
    {
      kind: 'select',
      key: 'month',
      label: t('report.month'),
      allLabel: formatMonth(currentMonth, config),
      options: months.slice(1).map((m) => ({ value: m, label: formatMonth(m, config) })),
    },
    {
      kind: 'select',
      key: 'rule',
      label: t('report.rule'),
      allLabel: t('report.allRules'),
      options: REPORT_RULES.map((r) => ({ value: r.key, label: t(`rules.${r.key}.name`) })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('report.section'),
      allLabel: t('report.allSections'),
      options: sectionOptions,
    },
  ];

  const report = query.data;
  return (
    <PageContainer size="wide">
      <PageHeader
        title={t('report.title')}
        subtitle={t('report.subtitle')}
        actions={[
          {
            id: 'csv',
            label: t('report.downloadCsv'),
            icon: <DownloadIcon aria-hidden className="size-4" />,
            priority: 'primary',
            onClick: () => void downloadCsv(),
            disabled: query.isLoading || query.isError,
            busy: csvBusy,
          },
        ]}
      />
      <FilterBar
        fields={fields}
        values={state.filters}
        onChange={(patch) => actions.setFilters(patch)}
      />

      {query.isError ? (
        <ErrorState message={t('report.loadError')} onRetry={() => void query.refetch()} />
      ) : !report ? (
        <div className="flex flex-col gap-6" role="status" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i} padded>
                <Skeleton className="h-16 w-full" />
              </Card>
            ))}
          </div>
          <SkeletonTable rows={5} columns={5} />
        </div>
      ) : (
        <>
          <AlertsReportFacts report={report} />
          <Card className="overflow-hidden">
            <h2 className="p-4 text-h2 md:p-5">{t('report.byRuleTitle')}</h2>
            {report.rows.length === 0 ? (
              <EmptyState
                title={t('report.emptyTitle', { month: formatMonth(report.month, config) })}
                explanation={t('report.emptyBody')}
              />
            ) : (
              <AlertsReportTable report={report} />
            )}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
