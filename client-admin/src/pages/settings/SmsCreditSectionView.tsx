/**
 * [15.6.8/#551] Presentational half of `SmsCreditSection` — mode label,
 * available/reserved, and the ledger table, driven entirely by props so
 * Storybook can cover every state without a live `useSmsCredits()` call.
 */
import { Card, DataTable, ErrorState, type DataTableColumn } from '@biddaloy/ui/components';
import type { SmsCreditLedgerItem, SmsCreditsResponse } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

export interface SmsCreditSectionViewProps {
  credits?: SmsCreditsResponse;
  loading: boolean;
  error?: boolean;
  page: number;
  pageSize: number;
  isFetching?: boolean;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

export function SmsCreditSectionView({
  credits,
  loading,
  error,
  page,
  pageSize,
  isFetching,
  onPageChange,
  onRetry,
}: SmsCreditSectionViewProps) {
  const { t } = useTranslation('settings');
  const config = useRegionConfig();

  const columns: DataTableColumn<SmsCreditLedgerItem>[] = [
    {
      id: 'kind',
      header: t('smsCredit.ledger.kindHeader'),
      accessorFn: (row) => t(`smsCredit.ledger.kind.${row.kind}`),
    },
    {
      id: 'units',
      header: t('smsCredit.ledger.unitsHeader'),
      accessorFn: (row) => (row.units > 0 ? `+${row.units}` : String(row.units)),
    },
    {
      id: 'reference',
      header: t('smsCredit.ledger.referenceHeader'),
      accessorFn: (row) =>
        row.reference_id
          ? `${t(`smsCredit.ledger.referenceType.${row.reference_type}`)} · ${row.reference_id}`
          : '—',
    },
    {
      id: 'reason',
      header: t('smsCredit.ledger.reasonHeader'),
      accessorFn: (row) => row.reason ?? '—',
    },
    {
      id: 'createdAt',
      header: t('smsCredit.ledger.dateHeader'),
      accessorFn: (row) => formatDate(new Date(row.created_at), config),
    },
  ];

  return (
    <section
      aria-label={t('smsCredit.legend')}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 className="text-sm font-semibold">{t('smsCredit.legend')}</h2>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('smsCredit.loading')}</p>
      ) : error || !credits ? (
        <ErrorState
          message={t('smsCredit.loadError')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={onRetry}
        />
      ) : (
        <>
          <Card className="flex flex-col gap-2 p-3">
            <p className="text-sm font-medium">
              {credits.metering === 'PLATFORM'
                ? t('smsCredit.modePlatform')
                : t('smsCredit.modeOff')}
            </p>
            {credits.metering === 'PLATFORM' && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t('smsCredit.available')}</dt>
                  <dd className="tabular-nums">{credits.available}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('smsCredit.reserved')}</dt>
                  <dd className="tabular-nums">{credits.reserved}</dd>
                </div>
              </dl>
            )}
          </Card>

          <DataTable
            tableId="sms-credit-ledger"
            caption={t('smsCredit.ledger.caption')}
            columns={columns}
            data={credits.ledger.data}
            getRowId={(row) => row.id}
            sorting={null}
            onSortingChange={() => undefined}
            page={page}
            pageSize={pageSize}
            totalCount={credits.ledger.total}
            onPageChange={onPageChange}
            loading={false}
            isFetching={isFetching ?? false}
            emptyMessage={t('smsCredit.ledger.empty')}
          />
        </>
      )}
    </section>
  );
}
