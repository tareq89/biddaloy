import { Button, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { usePlatformHistory, type PlatformHistoryRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

/**
 * History tab: owner sign-ins, locks and unlocks, newest first, "Load more" follows the server's
 * cursor. Uses `DataTable` directly rather than `ListShell`: the page's `DetailShell` already
 * owns the heading and container, and `ListShell` would add a second `<h1>` and a nested page.
 */
export function HistoryTab() {
  const { t } = useTranslation('platformOwners');
  const config = useRegionConfig();
  const history = usePlatformHistory();
  const rows = history.data?.pages.flatMap((p) => p.data) ?? [];

  const columns: DataTableColumn<PlatformHistoryRow>[] = [
    {
      id: 'label',
      header: t('history.columnAction'),
      accessorFn: (row) => (
        <span className="font-medium">
          {t(`history.actions.${row.action}`, { defaultValue: row.label })}
        </span>
      ),
      card: 'title',
    },
    {
      id: 'who',
      header: t('history.columnWho'),
      accessorFn: (row) => row.actorName ?? t('history.someone'),
    },
    {
      id: 'when',
      header: t('history.columnWhen'),
      accessorFn: (row) => formatDateTime(row.at, config),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <p className="text-caption text-text-secondary" aria-live="polite">
          {t('history.total', { shown: rows.length })}
        </p>
      )}
      <DataTable
        tableId="platform-owner-history"
        caption={t('history.caption')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => undefined}
        totalCount={rows.length}
        paginated={false}
        loading={history.isLoading}
        {...(history.isError ? { error: t('history.loadError') } : {})}
        emptyState={{
          kind: 'empty',
          title: t('history.empty'),
          explanation: t('history.emptyExplanation'),
        }}
      />
      {history.hasNextPage && (
        <Button
          variant="outline"
          size="lg"
          className="self-center"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t('history.loadMore')}
        </Button>
      )}
    </div>
  );
}
