/**
 * [28.4.2] Surveys tab: every survey with its status, table on desktop and
 * cards on phone (`DataTable`'s own `card` roles, D23). The server returns
 * them all (no paging), so rows are shown in one page.
 */
import { Button, type DataTableColumn } from '@biddaloy/ui/components';
import { useSurveys, type Survey } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

export interface SurveysListProps {
  /** Opens the create dialog; omitted for a caller who cannot write. */
  onNew?: () => void;
}

export function SurveysList({ onNew }: SurveysListProps) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const query = useSurveys();
  const rows = query.data ?? [];

  const columns: DataTableColumn<Survey>[] = [
    {
      id: 'title',
      header: t('surveys.columnTitle'),
      accessorFn: (row) => (
        <Link
          to="/staff/evaluations/surveys/$surveyId"
          params={{ surveyId: row.id }}
          data-focus-anchor={row.id}
          className="font-medium underline"
        >
          {row.title}
        </Link>
      ),
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
      accessorFn: (row) => t(`surveys.status.${row.status}`),
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
    <ListShell
      title={t('surveys.title')}
      {...(onNew
        ? {
            primaryAction: (
              <Button type="button" onClick={onNew}>
                {t('surveys.new')}
              </Button>
            ),
          }
        : {})}
      tableId="surveys-list"
      caption={t('surveys.title')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      page={1}
      pageSize={Math.max(rows.length, 1)}
      totalCount={rows.length}
      onPageChange={() => undefined}
      loading={query.isLoading}
      loadingMessage={t('surveys.loading')}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('surveys.loadError') } : {})}
      emptyMessage={t('surveys.empty')}
    />
  );
}
