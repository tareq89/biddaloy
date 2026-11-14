/** #3889 Schools whose seats ended and did not renew. Each row opens that school's billing (D10). */
import { Button, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { NotRenewedRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

export function NotRenewedList({ rows, loading }: { rows: NotRenewedRow[]; loading?: boolean }) {
  const { t } = useTranslation('moneyRevenue');
  const config = useRegionConfig();

  const columns: DataTableColumn<NotRenewedRow>[] = [
    { id: 'name', header: t('notRenewed.name'), accessorFn: (r) => r.name, card: 'title' },
    {
      id: 'endedOn',
      header: t('notRenewed.endedOn'),
      accessorFn: (r) => formatDate(r.paid_until, config),
    },
    {
      id: 'daysAgo',
      header: t('notRenewed.daysAgo'),
      accessorFn: (r) => formatNumber(r.days_since_ended, config),
      align: 'end',
    },
    { id: 'plan', header: t('notRenewed.plan'), accessorFn: (r) => r.plan ?? '' },
    {
      id: 'open',
      header: t('notRenewed.open'),
      accessorFn: (r) => (
        <Button asChild variant="link" className="min-h-11 md:min-h-0">
          <Link to="/schools/$schoolId" params={{ schoolId: r.school_id }}>
            {t('notRenewed.open')}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      tableId="money-not-renewed"
      caption={t('notRenewed.caption')}
      columns={columns}
      data={rows}
      getRowId={(r) => r.school_id}
      sorting={null}
      onSortingChange={() => undefined}
      totalCount={rows.length}
      paginated={false}
      loading={loading ?? false}
      emptyState={{
        title: t('notRenewed.emptyTitle'),
        explanation: t('notRenewed.emptyDescription'),
      }}
    />
  );
}
