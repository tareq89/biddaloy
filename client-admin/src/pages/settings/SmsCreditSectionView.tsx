/**
 * [15.6.8/#551] Presentational half of `SmsCreditSection` — mode badge,
 * available/reserved tiles, and the ledger table, driven entirely by props so
 * Storybook can cover every state without a live `useSmsCredits()` call.
 */
import { DataTable, ErrorState, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type { SmsCreditLedgerItem, SmsCreditsResponse } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

import { SettingsSection } from './settings-layout';

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

  // D9: the reference shows its type only; the record id is never printed.
  const columns: DataTableColumn<SmsCreditLedgerItem>[] = [
    {
      id: 'createdAt',
      header: t('smsCredit.ledger.dateHeader'),
      accessorFn: (row) => formatDate(new Date(row.created_at), config),
      card: 'subtitle',
    },
    {
      id: 'kind',
      header: t('smsCredit.ledger.kindHeader'),
      accessorFn: (row) => t(`smsCredit.ledger.kind.${row.kind}`),
      card: 'title',
    },
    {
      id: 'units',
      header: t('smsCredit.ledger.unitsHeader'),
      accessorFn: (row) =>
        row.units > 0 ? `+${formatNumber(row.units, config)}` : formatNumber(row.units, config),
      align: 'end',
      card: 'badge',
    },
    {
      id: 'reference',
      header: t('smsCredit.ledger.referenceHeader'),
      accessorFn: (row) =>
        row.reference_type ? t(`smsCredit.ledger.referenceType.${row.reference_type}`) : '—',
      card: 'field',
    },
    {
      id: 'reason',
      header: t('smsCredit.ledger.reasonHeader'),
      accessorFn: (row) => row.reason ?? '—',
      card: 'field',
    },
  ];

  const platform = credits?.metering === 'PLATFORM';
  const loaded = !loading && !error && credits;

  return (
    <SettingsSection
      id="sms-credit-section"
      title={t('smsCredit.legend')}
      description={loaded && !platform ? t('smsCredit.descriptionOff') : t('smsCredit.description')}
      badge={
        loaded ? (
          <StatusBadge
            tone={platform ? 'info' : 'neutral'}
            label={t(platform ? 'smsCredit.modePlatform' : 'smsCredit.modeOff')}
          />
        ) : undefined
      }
    >
      {loading ? (
        <div aria-busy="true" className="mt-4 grid grid-cols-2 gap-3">
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
        </div>
      ) : error || !credits ? (
        <div className="mt-4">
          <ErrorState
            message={t('smsCredit.loadError')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <>
          {platform && (
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted p-3">
                <dt className="text-caption text-text-secondary">{t('smsCredit.available')}</dt>
                <dd className="text-h2 tabular-nums">{formatNumber(credits.available, config)}</dd>
              </div>
              <div className="rounded-md bg-muted p-3">
                <dt className="text-caption text-text-secondary">{t('smsCredit.reserved')}</dt>
                <dd className="text-h2 tabular-nums">{formatNumber(credits.reserved, config)}</dd>
              </div>
            </dl>
          )}

          <h3 className="mt-6 text-h3">{t('smsCredit.ledgerTitle')}</h3>
          <div className="mt-2">
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
              emptyState={{
                title: t('smsCredit.ledger.empty'),
                explanation: t('smsCredit.ledger.emptyExplanation'),
              }}
            />
          </div>
        </>
      )}
    </SettingsSection>
  );
}
