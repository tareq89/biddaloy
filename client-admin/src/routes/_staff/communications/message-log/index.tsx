/**
 * `/communications/message-log` — [87.SD] the tenant-wide message log, [97.4.02] now a nav item
 * with every filter in the URL, a row detail and Check status. The dashboard's Failed messages
 * and SMS balance widgets open it with `?medium=SMS&status=FAILED` / `?medium=SMS`.
 * `?student=<id>` / `?guardian=<id>` (linked from their detail pages) show one person's messages
 * from the endpoints those pages already use.
 *
 * Gated on COMMUNICATION_BULK_SEND like Reminder history: the endpoint is
 * tenant-wide, and teachers (who hold LOG_READ) must never see it.
 */
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { ApiError, getActiveTenant } from '@biddaloy/ui/api';
import {
  RoutePending,
  StatusBadge,
  statusLabelKey,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  communicationLogsQueryOptions,
  useCheckMessageStatus,
  useCommunicationLogs,
  useGuardianCommunicationLogs,
  useMessagingProviders,
  useStudentCommunicationLogs,
  useUsers,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDateTime, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleAlertIcon, MessageSquareIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { deliveryErrorKey } from '../-shared/delivery-error';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import type { LogRow } from './-log-row';
import { RowDetail } from './-row-detail';

const logsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  // A hand-edited value the API would 400 on is dropped instead.
  status: z.enum(CommunicationStatus).optional().catch(undefined),
  medium: z.enum(CommunicationMedium).optional().catch(undefined),
  from_date: z.string().optional().catch(undefined),
  to_date: z.string().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  trigger: z.enum(CommunicationTrigger).optional().catch(undefined),
  sent_by: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
  guardian: z.string().uuid().optional().catch(undefined),
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
    search: search.search,
    trigger: search.trigger,
    sentBy: search.sent_by,
    provider: search.provider,
    scoped: Boolean(search.student ?? search.guardian),
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // The scoped views read their own endpoints in the component.
      deps.scoped
        ? undefined
        : queryClient
            .ensureQueryData(
              communicationLogsQueryOptions({
                page: deps.page,
                limit: deps.limit,
                ...(deps.status ? { status: deps.status } : {}),
                ...(deps.medium ? { medium: deps.medium } : {}),
                ...(deps.fromDate ? { from_date: deps.fromDate } : {}),
                ...(deps.toDate ? { to_date: deps.toDate } : {}),
                ...(deps.search ? { search: deps.search } : {}),
                ...(deps.trigger ? { trigger: deps.trigger } : {}),
                ...(deps.sentBy ? { sent_by: deps.sentBy } : {}),
                ...(deps.provider ? { provider: deps.provider } : {}),
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
  const { student, guardian } = Route.useSearch();
  return (
    <RegionConfigProvider value={regionConfig}>
      {student ? (
        <ScopedList kind="student" id={student} />
      ) : guardian ? (
        <ScopedList kind="guardian" id={guardian} />
      ) : (
        <MessageLogList />
      )}
    </RegionConfigProvider>
  );
}

type Companies = Map<string, { label: string; status: boolean }>;

/** Companies the school can send through (label + whether it can report delivery). Empty for a
 * role that cannot read the settings: then the Company filter is simply not offered. */
function useCompanies(): Companies {
  const providers = useMessagingProviders(getActiveTenant() ?? '').data;
  const { i18n } = useTranslation();
  const bn = i18n.language.startsWith('bn');
  return React.useMemo(() => {
    const byName: Companies = new Map();
    for (const medium of Object.values(providers ?? {})) {
      for (const p of medium.providers) {
        byName.set(p.name, {
          label: bn ? p.label.bn : p.label.en,
          status: p.capabilities.includes('status'),
        });
      }
    }
    return byName;
  }, [providers, bn]);
}

/** D23: only a SENT message with a company id, from a company that can report delivery. Without
 * the companies list (a role that cannot read it) the server decides, with its fixed 409. */
function canCheckStatus(row: LogRow, companies: Companies) {
  if (row.status !== 'SENT' || !row.provider_message_id || !row.provider) return false;
  return companies.size === 0 || companies.get(row.provider)?.status === true;
}

function useLogColumns(onView: (row: LogRow) => void, companies: Companies) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const columns: DataTableColumn<LogRow>[] = [
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
      accessorFn: (row) => formatDateTime(new Date(row.created_at), config),
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
      id: 'trigger',
      header: t('messageLog.columnTrigger'),
      accessorFn: (row) => (row.trigger ? t(`messageLog.triggers.${row.trigger}`) : '—'),
    },
    {
      id: 'company',
      header: t('messageLog.columnCompany'),
      accessorFn: (row) =>
        row.provider ? (companies.get(row.provider)?.label ?? row.provider) : '—',
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
  const rowActions = (row: LogRow) => [
    { intent: 'view' as const, label: t('messageLog.viewDetail'), onClick: () => onView(row) },
  ];
  return { columns, rowActions };
}

function MessageLogList() {
  const { t } = useTranslation('communications');
  const [state, actions] = useListShellState();
  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  const companies = useCompanies();
  const check = useCheckMessageStatus();

  const filters = state.filters as {
    status?: string;
    medium?: string;
    from_date?: string;
    to_date?: string;
    search?: string;
    trigger?: string;
    sent_by?: string;
    provider?: string;
  };

  const logsQuery = useCommunicationLogs({
    page: state.page,
    limit: state.limit,
    ...(filters.status ? { status: filters.status as CommunicationStatus } : {}),
    ...(filters.medium ? { medium: filters.medium as CommunicationMedium } : {}),
    ...(filters.from_date ? { from_date: filters.from_date } : {}),
    ...(filters.to_date ? { to_date: filters.to_date } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.trigger ? { trigger: filters.trigger as CommunicationTrigger } : {}),
    ...(filters.sent_by ? { sent_by: filters.sent_by } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
  });
  // Staff who can be named as the sender. A role that cannot read /users gets no such filter.
  const staffQuery = useUsers({ limit: 100 });

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('messageLog.searchLabel'),
      placeholder: t('messageLog.searchPlaceholder'),
      primary: true,
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
      key: 'trigger',
      label: t('messageLog.triggerFilterLabel'),
      allLabel: t('messageLog.allTriggers'),
      options: Object.values(CommunicationTrigger).map((trigger) => ({
        value: trigger,
        label: t(`messageLog.triggers.${trigger}`),
      })),
    },
    ...(staffQuery.data?.data.length
      ? [
          {
            kind: 'select' as const,
            key: 'sent_by',
            label: t('messageLog.sentByLabel'),
            allLabel: t('messageLog.allSenders'),
            options: staffQuery.data.data.map((user) => ({ value: user.id, label: user.full_name })),
          },
        ]
      : []),
    ...(companies.size
      ? [
          {
            kind: 'select' as const,
            key: 'provider',
            label: t('messageLog.companyLabel'),
            allLabel: t('messageLog.allCompanies'),
            options: [...companies].map(([value, { label }]) => ({ value, label })),
          },
        ]
      : []),
    {
      kind: 'date-range',
      fromKey: 'from_date',
      toKey: 'to_date',
      label: t('messageLog.dateRangeLabel'),
      fromLabel: t('messageLog.fromDateLabel'),
      toLabel: t('messageLog.toDateLabel'),
    },
  ];

  const rows: LogRow[] = logsQuery.data?.data ?? [];
  const viewed = rows.find((row) => row.id === viewId);
  const { columns, rowActions } = useLogColumns((row) => setViewId(row.id), companies);
  const filtered = Object.values(filters).some(Boolean);

  const runCheck = (id: string) =>
    check.mutate(id, {
      onSuccess: () => toast.success(t('messageLog.checkStatusDone')),
      // 409 / 502 carry the server's one fixed sentence; anything else gets ours (Rule 23/24).
      onError: (error) =>
        toast.error(
          error instanceof ApiError && [409, 502].includes(error.statusCode)
            ? error.message
            : t('messageLog.checkStatusFailed'),
        ),
    });

  return (
    <>
      <ListShell
        title={t('messageLog.title')}
        subtitle={t('messageLog.subtitle')}
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="communication-logs"
        caption={t('messageLog.tableCaption')}
        columns={columns}
        rowActions={rowActions}
        data={rows}
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
          kind: filtered ? 'no-results' : 'empty',
          title: t(filtered ? 'messageLog.noMatch' : 'messageLog.empty'),
          explanation: t(filtered ? 'messageLog.noMatchHelp' : 'messageLog.emptyHelp'),
        }}
      />
      <RowDetail
        row={viewed}
        onClose={() => setViewId(undefined)}
        companyLabel={(name) => (name ? (companies.get(name)?.label ?? null) : null)}
        canCheck={viewed ? canCheckStatus(viewed, companies) : false}
        checking={check.isPending}
        onCheck={() => viewed && runCheck(viewed.id)}
      />
    </>
  );
}

/** One student's or guardian's messages, from the endpoints their detail pages already use.
 * Those carry no filters yet (#3343), so none are offered here. */
function ScopedList({ kind, id }: { kind: 'student' | 'guardian'; id: string }) {
  const { t } = useTranslation('communications');
  const navigate = useNavigate();
  const [state, actions] = useListShellState();
  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  const studentQuery = useStudentCommunicationLogs(kind === 'student' ? id : '');
  const guardianQuery = useGuardianCommunicationLogs(kind === 'guardian' ? id : '');
  const query = kind === 'student' ? studentQuery : guardianQuery;

  const all: LogRow[] = (query.data ?? [])
    .map((r) => ({ ...r, trigger: null, student_id: null, guardian_id: null, provider: null }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit);
  const viewed = all.find((row) => row.id === viewId);
  const { columns, rowActions } = useLogColumns((row) => setViewId(row.id), new Map());

  return (
    <>
      <ListShell
        title={t('messageLog.title')}
        subtitle={t(kind === 'student' ? 'messageLog.scopedStudent' : 'messageLog.scopedGuardian')}
        actions={[
          {
            id: 'all',
            label: t('messageLog.scopedClear'),
            onClick: () => void navigate({ to: '/communications/message-log', search: {} }),
          },
        ]}
        tableId="communication-logs-scoped"
        caption={t('messageLog.tableCaption')}
        columns={columns}
        rowActions={rowActions}
        data={rows}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={all.length}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={query.isPending}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('messageLog.error') } : {})}
        emptyState={{
          icon: <MessageSquareIcon aria-hidden />,
          title: t('messageLog.empty'),
          explanation: t('messageLog.scopedNote'),
        }}
      />
      <RowDetail
        row={viewed}
        onClose={() => setViewId(undefined)}
        companyLabel={() => null}
        canCheck={false}
        checking={false}
        onCheck={() => {}}
      />
    </>
  );
}

function MessageLogPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
