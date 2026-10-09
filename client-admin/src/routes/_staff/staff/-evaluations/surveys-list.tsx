/**
 * [28.4.2] Surveys tab: every survey with its status, table on desktop and
 * cards on phone (`DataTable`'s own `card` roles, D23). The server returns
 * them all (no paging), so the table is unpaginated. The page header owns the
 * "New survey" button.
 */
import {
  DataTable,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
} from '@biddaloy/ui/components';
import { useSurveys, type Survey } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

export const SURVEY_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  OPEN: 'success',
  CLOSED: 'info',
};

export function SurveysList() {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const query = useSurveys();
  const rows = query.data ?? [];

  const columns: DataTableColumn<Survey>[] = [
    {
      id: 'title',
      header: t('surveys.columnTitle'),
      accessorFn: (row) => <span className="font-medium">{row.title}</span>,
      card: 'title',
    },
    {
      id: 'respondents',
      header: t('surveys.columnRespondents'),
      accessorFn: (row) => t(`surveys.respondents.${row.respondent}`),
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('surveys.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={SURVEY_STATUS_TONE[row.status] ?? 'neutral'}
          label={t(`surveys.status.${row.status}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'closes',
      header: t('surveys.columnCloses'),
      accessorFn: (row) =>
        row.closes_at ? formatDate(new Date(row.closes_at), regionConfig) : '—',
    },
  ];

  return (
    <DataTable
      tableId="surveys-list"
      caption={t('surveys.title')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      totalCount={rows.length}
      paginated={false}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('surveys.open'),
          to: `/staff/evaluations/surveys/${row.id}`,
          'data-focus-anchor': row.id,
        },
      ]}
      loading={query.isLoading}
      loadingMessage={t('surveys.loading')}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('surveys.loadError') } : {})}
      emptyState={{ title: t('surveys.empty'), explanation: t('surveys.emptyBody') }}
    />
  );
}
