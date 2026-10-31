/**
 * `/communications/message-log` — [87.SD] the tenant-wide message log, [97.4.02] now a nav item
 * with every filter in the URL, a row detail and Check status. The dashboard's Failed messages
 * and SMS balance widgets open it with `?medium=SMS&status=FAILED` / `?medium=SMS`.
 * `?student=<id>` / `?guardian=<id>` (linked from their detail pages) show one person's messages
 * from the endpoints those pages already use.
 *
 * Gated on COMMUNICATION_BULK_SEND like Reminder history: the endpoint is
 * tenant-wide, and teachers (who hold LOG_READ) must never see it. Every request this page makes
 * (the log, its filter choices, Check status) needs that permission only.
 */
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
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
  useMessageLogFilterOptions,
  useStudentCommunicationLogs,
  type CommunicationLogListFilters,
  type MessageLogFilterOptions,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDateTime, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlertIcon, MessageSquareIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { deliveryErrorKey } from '../-shared/delivery-error';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { fromScopedLog, type LogRow } from './-log-row';
import { RowDetail } from './-row-detail';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Each value is limited the way `QueryCommunicationLogsDto` limits it: a hand-edited value the
// API would 400 on is dropped instead, so the list still loads.
const logsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  status: z.enum(CommunicationStatus).optional().catch(undefined),
  medium: z.enum(CommunicationMedium).optional().catch(undefined),
  from_date: isoDay.optional().catch(undefined),
  to_date: isoDay.optional().catch(undefined),
  search: z.string().max(100).optional().catch(undefined),
  trigger: z.enum(CommunicationTrigger).optional().catch(undefined),
  sent_by: z.string().uuid().optional().catch(undefined),
  provider: z.string().max(40).optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
  guardian: z.string().uuid().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores selection under.
  selected: z.string().optional().catch(undefined),
});

const FILTER_KEYS = [
  'status',
  'medium',
  'from_date',
  'to_date',
  'search',
  'trigger',
  'sent_by',
  'provider',
] as const;
type FilterValues = Partial<Record<(typeof FILTER_KEYS)[number], string | undefined>>;

/** URL values -> API params, one place for the loader and the list (so both use one query key). */
function toLogFilters(values: FilterValues, page: number, limit: number) {
  const filters: Record<string, string | number> = { page, limit };
  for (const key of FILTER_KEYS) {
    const value = values[key];
    if (value) filters[key] = value;
  }
  return filters as CommunicationLogListFilters;
}

export const Route = createFileRoute('/_staff/communications/message-log/')({
  validateSearch: logsSearchSchema,
  loaderDeps: ({ search }) => ({
    filters: toLogFilters(search, search.page ?? 1, search.limit ?? 25),
    scoped: Boolean(search.student ?? search.guardian),
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // The scoped views read their own endpoints in the component.
      deps.scoped
        ? undefined
        : queryClient
            .ensureQueryData(communicationLogsQueryOptions(deps.filters))
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

const NO_COMPANIES = new Map<string, string>();
const NO_COMPANY_LIST: MessageLogFilterOptions['companies'] = [];

/** Company name -> label in the current language, from the log's own filter-options list. */
function useCompanyLabels(companies: MessageLogFilterOptions['companies'] = NO_COMPANY_LIST) {
  const { i18n } = useTranslation();
  const bn = i18n.language.startsWith('bn');
  return React.useMemo(
    () => new Map(companies.map((c) => [c.name, bn ? c.label.bn : c.label.en])),
    [companies, bn],
  );
}

/**
 * Check status refusals in the user's language, chosen by status code; never the server's text
 * (Rule 23/24). null: the app's mutation handler already says it (403, restore freeze, demo).
 */
function checkErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiError)) return 'messageLog.checkStatusFailed';
  const code = error.details?.code;
  if (
    error.statusCode === 403 ||
    error.statusCode === 423 ||
    (typeof code === 'string' && code.startsWith('DEMO_'))
  ) {
    return null;
  }
  return error.statusCode === 409 ? 'messageLog.checkStatusCannot' : 'messageLog.checkStatusFailed';
}

function useLogColumns(onView: (row: LogRow) => void, companies: Map<string, string>) {
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
      accessorFn: (row) => (row.provider ? (companies.get(row.provider) ?? row.provider) : '—'),
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
  // The row itself, not its id: a refetch that moves it off this page must not close the dialog
  // in the middle of a check. A fresher copy on the page still wins.
  const [viewed, setViewed] = React.useState<LogRow | undefined>(undefined);
  const options = useMessageLogFilterOptions().data;
  const companies = useCompanyLabels(options?.companies);
  const check = useCheckMessageStatus();

  const filters = state.filters as FilterValues;
  const logsQuery = useCommunicationLogs(toLogFilters(filters, state.page, state.limit));

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
    ...(options?.senders.length
      ? [
          {
            kind: 'select' as const,
            key: 'sent_by',
            label: t('messageLog.sentByLabel'),
            allLabel: t('messageLog.allSenders'),
            options: options.senders.map((user) => ({ value: user.id, label: user.full_name })),
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
            options: [...companies].map(([value, label]) => ({ value, label })),
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
  const shown = viewed && (rows.find((row) => row.id === viewed.id) ?? viewed);
  const { columns, rowActions } = useLogColumns(setViewed, companies);
  const filtered = FILTER_KEYS.some((key) => filters[key]);

  // A fast double click can land before React shows the busy button (21-ui-patterns §6).
  const inFlight = React.useRef(false);
  const runCheck = (id: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    check.mutate(id, {
      onSuccess: (row) => {
        setViewed(row);
        toast.success(t('messageLog.checkStatusDone'));
      },
      onError: (error) => {
        const key = checkErrorKey(error);
        if (key) toast.error(t(key));
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };

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
        row={shown}
        onClose={() => setViewed(undefined)}
        companyLabel={(name) => (name ? (companies.get(name) ?? null) : null)}
        checking={check.isPending}
        onCheck={() => shown && runCheck(shown.id)}
      />
    </>
  );
}

/** One student's or guardian's messages, from the endpoints their detail pages already use.
 * Those carry no filters yet (#3343), so none are offered here. */
function ScopedList({ kind, id }: { kind: 'student' | 'guardian'; id: string }) {
  const { t } = useTranslation('communications');
  const [state, actions] = useListShellState();
  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  // The hook not in use gets '' and stays idle (`enabled`).
  const studentQuery = useStudentCommunicationLogs(kind === 'student' ? id : '');
  const guardianQuery = useGuardianCommunicationLogs(kind === 'guardian' ? id : '');
  const query = kind === 'student' ? studentQuery : guardianQuery;

  // The server already answers newest first.
  const all = React.useMemo(() => (query.data ?? []).map(fromScopedLog), [query.data]);
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit);
  const viewed = all.find((row) => row.id === viewId);
  const { columns, rowActions } = useLogColumns((row) => setViewId(row.id), NO_COMPANIES);

  return (
    <>
      <ListShell
        title={t('messageLog.title')}
        subtitle={t(kind === 'student' ? 'messageLog.scopedStudent' : 'messageLog.scopedGuardian')}
        actions={[
          { id: 'all', label: t('messageLog.scopedClear'), to: '/communications/message-log' },
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
          explanation: t(
            kind === 'student' ? 'messageLog.scopedEmptyStudent' : 'messageLog.scopedEmptyGuardian',
          ),
        }}
      />
      <RowDetail row={viewed} onClose={() => setViewId(undefined)} companyLabel={() => null} />
    </>
  );
}

function MessageLogPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
