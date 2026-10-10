/** [67.5.06] Rule x section counts. No footer row (D41): the Total column and the "Total alerts" fact cover it. */
import type { AlertSeverity } from '@biddaloy/shared';
import { AlertSeverityBadge, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { AlertsReport } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

type Row = AlertsReport['rows'][number];

export function AlertsReportTable({ report }: { report: AlertsReport }) {
  const { t } = useTranslation('attention');
  const config = useTenantRegionConfig();
  const n = (value: number) => formatNumber(value, config);
  const countFor = (row: Row, sectionId: string | null) =>
    row.cells.find((c) => c.sectionId === sectionId)?.count ?? 0;
  const hasNoSection = report.rows.some((row) => countFor(row, null) > 0);

  const sections = [
    ...report.sections.map((s): { id: string | null; label: string } => ({
      id: s.id,
      label: s.label,
    })),
    ...(hasNoSection ? [{ id: null, label: t('report.noSection') }] : []),
  ];

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'rule',
      header: t('report.colRule'),
      // Phone: the non-zero "section: count" pairs sit under the name; the section columns are hidden.
      accessorFn: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{t(`rules.${row.ruleKey}.name`)}</span>
          <span className="text-caption text-text-secondary md:hidden">
            {sections
              .filter((s) => countFor(row, s.id) > 0)
              .map((s) => `${s.label}: ${n(countFor(row, s.id))}`)
              .join(' · ')}
          </span>
        </span>
      ),
      card: 'title',
    },
    {
      id: 'type',
      header: t('report.colType'),
      accessorFn: (row) => <AlertSeverityBadge severity={row.severity as AlertSeverity} />,
      card: 'badge',
    },
    ...sections.map((s): DataTableColumn<Row> => ({
      id: `section-${s.id ?? 'none'}`,
      header: s.label,
      accessorFn: (row) => n(countFor(row, s.id)),
      align: 'end',
      card: 'hidden',
    })),
    {
      id: 'total',
      header: t('report.colTotal'),
      accessorFn: (row) => n(row.total),
      align: 'end',
      card: 'subtitle',
    },
  ];

  return (
    <DataTable
      tableId="alerts-report"
      caption={t('report.byRuleTitle')}
      columns={columns}
      data={report.rows}
      getRowId={(row) => row.ruleKey}
      sorting={null}
      onSortingChange={() => undefined}
      totalCount={report.rows.length}
      paginated={false}
    />
  );
}
