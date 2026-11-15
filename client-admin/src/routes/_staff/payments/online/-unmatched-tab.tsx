import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useOnlinePaymentSubmissions, type ProofReviewListItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDateTime, formatServerAmount } from '@biddaloy/ui/utils';
import { Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

import { PAGE_LIMIT, STATUS_TONE } from './-online-tab';

/** [3.x/#3993] Online payments where some money went to the wallet (D12, D18). */
export function UnmatchedTab({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation('onlinePayments');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState();
  const query = useOnlinePaymentSubmissions({ unmatched: true, limit: PAGE_LIMIT });
  const items = query.data?.items ?? [];
  const money = (v: string) => formatServerAmount(v, regionConfig);

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
      header: t('unmatched.columnPaid'),
      accessorFn: (row) => money(row.amount),
      align: 'end',
      card: 'field',
    },
    {
      id: 'applied',
      header: t('unmatched.columnApplied'),
      accessorFn: (row) => money(row.appliedAmount),
      align: 'end',
      card: 'field',
    },
    {
      id: 'wallet',
      header: t('unmatched.columnWallet'),
      accessorFn: (row) => <span className="font-medium">{money(row.walletAmount)}</span>,
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
            ? t('unmatched.moreNote', { count: items.length })
            : t('unmatched.count', { count: items.length })
          : t('subtitle')
      }
      tabs={tabs}
      tableId="online-payments-unmatched"
      caption={t('unmatched.caption')}
      columns={columns}
      rowActions={(row) => [
        ...(row.paymentId
          ? [
              {
                intent: 'view' as const,
                label: t('online.openPayment'),
                to: `/payments/${row.paymentId}`,
              },
            ]
          : []),
        ...row.students.map((s) => ({
          intent: 'view' as const,
          label:
            row.students.length > 1
              ? t('unmatched.openWalletOf', { name: s.name })
              : t('unmatched.openWallet'),
          // The wallet and its payout live on the student's fees tab.
          to: `/students/${s.id}?tab=fees`,
        })),
      ]}
      data={items}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      totalCount={items.length}
      loading={query.isLoading}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('unmatched.error') } : {})}
      emptyState={{
        title: t('unmatched.emptyTitle'),
        explanation: t('unmatched.emptyText'),
        icon: <Wallet aria-hidden />,
      }}
    />
  );
}
