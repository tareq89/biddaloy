/**
 * `/communications/message-log` — [87.SD] the tenant-wide message log. The
 * dashboard's Failed messages and SMS balance widgets open it with
 * `?medium=SMS&status=FAILED` / `?medium=SMS`, so "See which ones" lands on
 * the messages that failed, not on the bulk-reminder rounds.
 *
 * Gated on COMMUNICATION_BULK_SEND like Reminder history: the endpoint is
 * tenant-wide, and teachers (who hold LOG_READ) must never see it.
 */
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import {
  RoutePending,
  StatusBadge,
  statusLabelKey,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  communicationLogsQueryOptions,
  useCommunicationLogs,
  type ReminderBatchLog,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlertIcon, MessageSquareIcon } from 'lucide-react';
import { z } from 'zod';

import { deliveryErrorKey } from '../-shared/delivery-error';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

const logsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  // A hand-edited value the API would 400 on is dropped instead.
  status: z.enum(CommunicationStatus).optional().catch(undefined),
  medium: z.enum(CommunicationMedium).optional().catch(undefined),
  from_date: z.string().optional().catch(undefined),
  to_date: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores selection under.
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/message-log/')({
  validateSearch: logsSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    status: search.status,
    medium: search.medium,
    fromDate: search.from_date,
    toDate: search.to_date,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient
        .ensureQueryData(
          communicationLogsQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...(deps.status ? { status: deps.status } : {}),
            ...(deps.medium ? { medium: deps.medium } : {}),
            ...(deps.fromDate ? { from_date: deps.fromDate } : {}),
            ...(deps.toDate ? { to_date: deps.toDate } : {}),
          }),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('communications'),
    ]),
  pendingComponent: MessageLogPending,
  component: MessageLogPage,
});

function MessageLogPage() {
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <MessageLogList />
    </RegionConfigProvider>
  );
}

function MessageLogList() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const [state, actions] = useListShellState();

  const filters = state.filters as {
    status?: string;
    medium?: string;
    from_date?: string;
    to_date?: string;
  };

  const logsQuery = useCommunicationLogs({
    page: state.page,
    limit: state.limit,
    ...(filters.status ? { status: filters.status as CommunicationStatus } : {}),
    ...(filters.medium ? { medium: filters.medium as CommunicationMedium } : {}),
    ...(filters.from_date ? { from_date: filters.from_date } : {}),
    ...(filters.to_date ? { to_date: filters.to_date } : {}),
  });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'status',
      label: t('messageLog.statusFilterLabel'),
      allLabel: t('messageLog.allStatuses'),
      options: Object.values(CommunicationStatus).map((status) => ({
        value: status,
        label: t(statusLabelKey('communication', status), { ns: 'common' }),
      })),
    },
    {
      kind: 'select',
      key: 'medium',
      label: t('messageLog.mediumFilterLabel'),
      allLabel: t('messageLog.allMediums'),
      options: Object.values(CommunicationMedium).map((medium) => ({
        value: medium,
        label: t(`mediums.${medium}`),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'from_date',
      toKey: 'to_date',
      label: t('messageLog.dateRangeLabel'),
      fromLabel: t('messageLog.fromDateLabel'),
      toLabel: t('messageLog.toDateLabel'),
    },
  ];

  const columns: DataTableColumn<ReminderBatchLog>[] = [
    {
      id: 'recipient',
      header: t('batches.detail.recipientHeader'),
      accessorFn: (row) => <span className="font-medium">{row.recipient_name}</span>,
      pinned: true,
      card: 'title',
    },
    {
      id: 'sent',
      header: t('messageLog.sentHeader'),
      accessorFn: (row) => formatDate(new Date(row.created_at), config),
      card: 'subtitle',
    },
    {
      id: 'channel',
      header: t('batches.detail.channelHeader'),
      accessorFn: (row) => t(`mediums.${row.medium}`),
    },
    {
      id: 'address',
      header: t('batches.detail.addressHeader'),
      accessorFn: (row) =>
        row.medium === 'EMAIL' ? row.recipient_address : formatPhone(row.recipient_address, config),
    },
    {
      id: 'status',
      header: t('batches.detail.statusHeader'),
      accessorFn: (row) => <StatusBadge domain="communication" status={row.status} />,
      card: 'badge',
    },
    {
      id: 'error',
      header: t('batches.detail.errorHeader'),
      accessorFn: (row) => {
        const key = deliveryErrorKey(row.error);
        if (key === null) return '—';
        return (
          <span className="flex items-start gap-1.5 text-status-overdue-fg">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(key, { medium: t(`mediums.${row.medium}`) })}
          </span>
        );
      },
    },
  ];

  return (
    <ListShell
      title={t('messageLog.title')}
      subtitle={t('messageLog.subtitle')}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      tableId="communication-logs"
      caption={t('messageLog.tableCaption')}
      columns={columns}
      data={logsQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={logsQuery.data?.total ?? 0}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={logsQuery.isPending}
      isFetching={logsQuery.isFetching}
      {...(logsQuery.isError ? { error: t('messageLog.error') } : {})}
      emptyState={{
        icon: <MessageSquareIcon aria-hidden />,
        title: t('messageLog.empty'),
        explanation: t('messageLog.emptyHelp'),
      }}
    />
  );
}

function MessageLogPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
