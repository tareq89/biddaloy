/**
 * [67.5.05] "Sent alerts": what this school sent by hand, with "seen N of M"
 * and a Withdraw action (behind a ConfirmDialog) on active rows.
 */
import type { AlertSeverity } from '@biddaloy/shared';
import {
  AlertSeverityBadge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  RowActions,
  StatusBadge,
  toast,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import { useManualAlerts, useWithdrawManualAlert, type ManualAlert } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

const PAGE_SIZE = 10;

const STATUS_TONE = { ACTIVE: 'success', WITHDRAWN: 'neutral', EXPIRED: 'info' } as const;

export function SentAlertsCard() {
  const { t } = useTranslation('attention');
  const config = useTenantRegionConfig();
  const [page, setPage] = React.useState(1);
  const [withdrawing, setWithdrawing] = React.useState<ManualAlert | null>(null);
  const query = useManualAlerts({ page, pageSize: PAGE_SIZE });
  const withdraw = useWithdrawManualAlert();
  const fmt = (n: number) => renderDigits(String(n), config.numerals);

  const columns: DataTableColumn<ManualAlert>[] = [
    {
      id: 'title',
      header: t('composer.colTitle'),
      accessorFn: (a) => <span className="font-medium">{a.title}</span>,
      card: 'title',
    },
    {
      id: 'type',
      header: t('composer.colType'),
      accessorFn: (a) => <AlertSeverityBadge severity={a.severity as AlertSeverity} />,
      card: 'badge',
    },
    {
      id: 'sent',
      header: t('composer.colSent'),
      accessorFn: (a) => formatDateTime(a.raisedAt, config),
    },
    {
      id: 'expires',
      header: t('composer.colExpires'),
      accessorFn: (a) => formatDateTime(a.expiresAt, config),
    },
    {
      id: 'seen',
      header: t('composer.colSeen'),
      accessorFn: (a) =>
        t('composer.seenValue', {
          seen: fmt(a.seenCount),
          total: fmt(a.recipientCount),
        }),
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('composer.colStatus'),
      accessorFn: (a) => {
        const status = a.status as keyof typeof STATUS_TONE;
        return (
          <StatusBadge
            tone={STATUS_TONE[status] ?? 'neutral'}
            label={t(`composer.status${status}`)}
          />
        );
      },
    },
    {
      id: 'actions',
      header: '',
      accessorFn: (a) => {
        const actions: RowAction[] =
          a.status === 'ACTIVE'
            ? [
                {
                  intent: 'remove',
                  display: 'text',
                  label: t('composer.withdraw'),
                  busy: withdraw.isPending && withdrawing?.id === a.id,
                  onClick: () => setWithdrawing(a),
                },
              ]
            : [];
        return <RowActions actions={actions} />;
      },
    },
  ];

  return (
    <Card padded aria-labelledby="sent-alerts-title" className="flex flex-col gap-4">
      <h2 id="sent-alerts-title" className="text-h2">
        {t('composer.sentTitle')}
      </h2>
      <DataTable
        tableId="sent-manual-alerts"
        caption={t('composer.sentTitle')}
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(a) => a.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={query.data?.total ?? 0}
        onPageChange={setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('composer.loadError') } : {})}
        emptyState={{ title: t('composer.emptyTitle'), explanation: t('composer.emptyBody') }}
      />
      {query.isError && (
        <Button variant="outline" className="self-start" onClick={() => void query.refetch()}>
          {t('composer.retry')}
        </Button>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => {
          if (!open) setWithdrawing(null);
        }}
        title={t('composer.withdrawTitle')}
        description={t('composer.withdrawBody', {
          count: withdrawing?.recipientCount ?? 0,
          n: fmt(withdrawing?.recipientCount ?? 0),
        })}
        confirmLabel={t('composer.withdraw')}
        busy={withdraw.isPending}
        onConfirm={() => {
          if (!withdrawing) return;
          withdraw.mutate(withdrawing.id, {
            onSuccess: () => toast.success(t('composer.withdrawn')),
            onError: () => toast.error(t('status.error', { ns: 'common' })),
            onSettled: () => setWithdrawing(null),
          });
        }}
      />
    </Card>
  );
}
