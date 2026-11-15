import { PaymentSubmissionStatus } from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn, type StatusTone } from '@biddaloy/ui/components';
import { useOnlinePaymentSubmissions, type ProofReviewListItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  ListShell,
  useListShellState,
  type FilterFieldDescriptor,
  type PageAction,
} from '@biddaloy/ui/shells';
import { formatDateTime, formatServerAmount } from '@biddaloy/ui/utils';
import { CreditCard } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** One page is 100 rows (the API's cap); the header's Next page walks the rest by cursor. */
export const PAGE_LIMIT = 100;

export const STATUS_TONE: Record<PaymentSubmissionStatus, StatusTone> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  DISCARDED: 'neutral',
  WITHDRAWN: 'neutral',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  REVERSED: 'neutral',
};

/** The statuses an online payment can be in (the proof-only ones never apply). */
const ONLINE_STATUSES = [
  PaymentSubmissionStatus.PENDING,
  PaymentSubmissionStatus.COMPLETED,
  PaymentSubmissionStatus.FAILED,
  PaymentSubmissionStatus.CANCELLED,
  PaymentSubmissionStatus.EXPIRED,
  PaymentSubmissionStatus.REVERSED,
] as const;

/** Header buttons: Next page (while the server has more) and First page (once past page one). */
export function pagingActions(
  t: (key: string) => string,
  cursor: string | undefined,
  nextCursor: string | null | undefined,
  setCursor: (c: string | undefined) => void,
): PageAction[] {
  return [
    ...(nextCursor
      ? [{ id: 'next', label: t('paging.next'), onClick: () => setCursor(nextCursor) }]
      : []),
    ...(cursor
      ? [{ id: 'first', label: t('paging.first'), onClick: () => setCursor(undefined) }]
      : []),
  ];
}

/** [3.x/#3993] Every online payment, with a status filter. */
export function OnlineTab({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation('onlinePayments');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const picked = ONLINE_STATUSES.find((s) => s === state.filters.status);
  // The cursor is only valid for the status that produced it (Back can change the status).
  const [page, setPage] = useState<{ status: string | undefined; cursor: string | undefined }>({
    status: undefined,
    cursor: undefined,
  });
  const cursor = page.status === picked ? page.cursor : undefined;
  const setCursor = (c: string | undefined) => setPage({ status: picked, cursor: c });
  const query = useOnlinePaymentSubmissions({
    ...(picked ? { status: picked } : {}),
    limit: PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  });
  const items = query.data?.items ?? [];

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'status',
      label: t('online.statusLabel'),
      allLabel: t('online.allStatuses'),
      options: ONLINE_STATUSES.map((s) => ({ value: s, label: t(`review.status.${s}`) })),
    },
  ];

  const columns: DataTableColumn<ProofReviewListItem>[] = [
    {
      id: 'submitter',
      header: t('list.columnSubmitter'),
      accessorFn: (row) => <span className="font-medium">{row.submitterName}</span>,
      card: 'title',
    },
    {
      id: 'date',
      header: t('online.columnDate'),
      accessorFn: (row) => formatDateTime(row.createdAt, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'students',
      header: t('online.columnStudents'),
      accessorFn: (row) => row.students.map((s) => s.name).join(', ') || '—',
      card: 'field',
    },
    {
      id: 'trxId',
      header: t('list.columnTrxId'),
      accessorFn: (row) => row.reference ?? '—',
      card: 'field',
    },
    {
      id: 'amount',
      header: t('list.columnAmount'),
      accessorFn: (row) => formatServerAmount(row.amount, regionConfig),
      align: 'end',
      card: 'field',
    },
    {
      id: 'status',
      header: t('online.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]} label={t(`review.status.${row.status}`)} />
      ),
      card: 'field',
    },
  ];

  return (
    <ListShell
      title={t('title')}
      subtitle={
        query.data
          ? query.data.nextCursor
            ? t('online.moreNote', { count: items.length })
            : t('online.count', { count: items.length })
          : t('subtitle')
      }
      tabs={tabs}
      actions={pagingActions(t, cursor, query.data?.nextCursor, setCursor)}
      filters={{
        fields: filterFields,
        values: state.filters,
        onChange: (next) => {
          setCursor(undefined);
          actions.setFilters(next);
        },
      }}
      tableId="online-payments-online"
      caption={t('online.caption')}
      columns={columns}
      rowActions={(row) => [
        row.paymentId
          ? { intent: 'view', label: t('online.openPayment'), to: `/payments/${row.paymentId}` }
          : { intent: 'view', label: t('online.openDetail'), to: `/payments/online/${row.id}` },
      ]}
      data={items}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      totalCount={items.length}
      loading={query.isLoading}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('online.error') } : {})}
      emptyState={{
        title: t('online.emptyTitle'),
        explanation: t('online.emptyText'),
        icon: <CreditCard aria-hidden />,
      }}
    />
  );
}
