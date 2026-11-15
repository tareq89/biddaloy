import { PaymentSubmissionStatus } from '@biddaloy/shared';
import {
  RoutePending,
  Tabs,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { usePaymentSubmissions, type ProofReviewListItem } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDateTime, formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { OnlineTab, PAGE_LIMIT } from './-online-tab';
import { UnmatchedTab } from './-unmatched-tab';

/**
 * `/payments/online` — [3.4.x] the accountant's lists: payment proofs waiting, every online
 * payment, and online payments that left money in the wallet (#3993).
 * The tab lives in the URL (`?tab=`), so a link can open a given tab.
 */
const searchSchema = z.object({
  tab: z.enum(['waiting', 'online', 'unmatched']).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/online/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('onlinePayments', 'payments', 'common'),
  pendingComponent: OnlinePaymentsPending,
  component: OnlinePaymentsPage,
});

function OnlinePaymentsPage() {
  const regionConfig = useTenantRegionConfig();
  const { tab = 'waiting' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { t } = useTranslation('onlinePayments');
  const tabs = (
    <Tabs
      value={tab}
      onValueChange={(next) =>
        void navigate({ search: { tab: next as 'waiting' | 'online' | 'unmatched' } })
      }
    >
      <TabsList aria-label={t('tabsLabel')}>
        <TabsTrigger value="waiting">{t('tabs.waiting')}</TabsTrigger>
        <TabsTrigger value="online">{t('tabs.online')}</TabsTrigger>
        <TabsTrigger value="unmatched">{t('tabs.unmatched')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  return (
    <RegionConfigProvider value={regionConfig}>
      {tab === 'online' ? (
        <OnlineTab tabs={tabs} />
      ) : tab === 'unmatched' ? (
        <UnmatchedTab tabs={tabs} />
      ) : (
        <WaitingList tabs={tabs} />
      )}
    </RegionConfigProvider>
  );
}

function WaitingList({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation('onlinePayments');
  const { t: tPayments } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const query = usePaymentSubmissions({
    status: PaymentSubmissionStatus.PENDING,
    limit: PAGE_LIMIT,
  });
  const items = query.data?.items ?? [];
  const [state, actions] = useListShellState();

  const columns: DataTableColumn<ProofReviewListItem>[] = [
    {
      id: 'submitter',
      header: t('list.columnSubmitter'),
      accessorFn: (row) => <span className="font-medium">{row.submitterName}</span>,
      card: 'title',
    },
    {
      id: 'submitted',
      header: t('list.columnSubmitted'),
      accessorFn: (row) => formatDateTime(row.createdAt, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'bills',
      header: t('list.columnBills'),
      accessorFn: (row) => t('list.billCount', { count: row.billCount }),
      card: 'field',
    },
    {
      id: 'method',
      header: t('list.columnMethod'),
      accessorFn: (row) => (row.method ? tPayments(`record.method.methods.${row.method}`) : '—'),
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
  ];

  return (
    <ListShell
      title={t('title')}
      subtitle={
        query.data
          ? query.data.nextCursor
            ? t('list.moreNote', { count: items.length })
            : t('list.count', { count: items.length })
          : t('subtitle')
      }
      tabs={tabs}
      tableId="online-payments-waiting"
      caption={t('list.caption')}
      columns={columns}
      rowActions={(row) => [
        { intent: 'view', label: t('list.review'), to: `/payments/online/${row.id}` },
      ]}
      data={items}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      totalCount={items.length}
      loading={query.isLoading}
      isFetching={query.isFetching}
      {...(query.isError ? { error: t('list.error') } : {})}
      emptyState={{
        title: t('list.emptyTitle'),
        explanation: t('list.emptyText'),
        icon: <Inbox aria-hidden />,
      }}
    />
  );
}

function OnlinePaymentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
