/**
 * `/communications/batches` — [8.11.9]'s Reminder History: every bulk
 * batch, newest first, with its delivery counts and a `StatusBadge`
 * whose PROCESSING → COMPLETED / PARTIALLY_FAILED / FAILED lifecycle
 * the detail page keeps polling. Row → `/communications/batches/$batchId`.
 *
 * Gated on COMMUNICATION_BULK_SEND, not the plan's COMMUNICATION_LOG_READ:
 * the batch read routes are `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` and
 * ACCOUNTANT — the persona whose sends fill this page — holds BULK_SEND
 * but not LOG_READ, so a LOG_READ gate would hide this page from the
 * very role that creates its contents. Same UX-gate-not-security-boundary
 * framing as `/communications/reminders`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, EmptyState, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useHasPermission,
  useReminderBatches,
  type ReminderBatchListItem,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

const batchesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/batches/')({
  validateSearch: batchesSearchSchema,
  component: ReminderHistoryPage,
});

function ReminderHistoryPage() {
  const { t } = useTranslation('communications');
  const navigate = useNavigate();
  const canView = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const regionConfig = useTenantRegionConfig();

  if (!canView) {
    return (
      <EmptyState
        title={t('batches.forbidden.title')}
        explanation={t('batches.forbidden.explanation')}
        action={{
          label: t('batches.forbidden.action'),
          onClick: () => void navigate({ to: '/dashboard' }),
        }}
      />
    );
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <ReminderHistoryList />
    </RegionConfigProvider>
  );
}

function ReminderHistoryList() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const [state, actions] = useListShellState({ limit: 20 });

  const batchesQuery = useReminderBatches({ page: state.page, limit: state.limit });

  const columns: DataTableColumn<ReminderBatchListItem>[] = [
    {
      id: 'name',
      header: t('batches.nameHeader'),
      accessorFn: (row) => (
        <Link
          to="/communications/batches/$batchId"
          params={{ batchId: row.id }}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {row.batch_name}
        </Link>
      ),
      pinned: true,
    },
    {
      id: 'created',
      header: t('batches.createdHeader'),
      accessorFn: (row) => formatDate(new Date(row.created_at), config),
    },
    {
      id: 'status',
      header: t('batches.statusHeader'),
      accessorFn: (row) => <StatusBadge domain="reminderBatch" status={row.status} />,
    },
    {
      id: 'recipients',
      header: t('batches.recipientsHeader'),
      accessorFn: (row) => String(row.total_recipients),
    },
    {
      id: 'successful',
      header: t('batches.successfulHeader'),
      accessorFn: (row) => String(row.successful_count),
    },
    {
      id: 'failed',
      header: t('batches.failedHeader'),
      accessorFn: (row) => String(row.failed_count),
    },
  ];

  return (
    <div className="p-4">
      <ListShell
        title={t('batches.title')}
        primaryAction={
          <Button asChild variant="outline">
            <Link to="/communications/reminders" search={{ mode: 'bulk' }}>
              {t('bulk.entryAction')}
            </Link>
          </Button>
        }
        tableId="reminder-batches"
        caption={t('batches.tableCaption')}
        columns={columns}
        data={batchesQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={batchesQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        loading={batchesQuery.isPending}
        {...(batchesQuery.isError ? { error: t('batches.error') } : {})}
        emptyMessage={t('batches.empty')}
      />
    </div>
  );
}
