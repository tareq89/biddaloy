/**
 * [28.4.2] Staff detail › ACR tab: per-year history, a Start ACR button
 * (ACR_WRITE) and small year-over-year bars (plain CSS, D24). Mounted only
 * behind ACR_READ by `$userId.tsx`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAcrStaffHistory,
  useHasPermission,
  type AcrAssessment,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';

import { StartAcrDialog } from './start-acr-dialog';
import { TabQueryState } from './tab-query-state';

export interface AcrTabProps {
  userId: string;
}

function TrendBars({
  rows,
  yearName,
}: {
  rows: AcrAssessment[];
  yearName: (id: string) => string;
}) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useRegionConfig();
  const scored = rows.filter((r) => r.total !== null);
  // ponytail: bars scale to this staff member's best year, not the form's
  // theoretical maximum; switch when the max score is exposed by the API.
  const max = Math.max(...scored.map((r) => r.total ?? 0), 1);
  if (scored.length < 2) return null;
  return (
    <section aria-labelledby="acr-trend-title" className="flex flex-col gap-2 p-4 md:px-5">
      <h3 id="acr-trend-title" className="text-h3">
        {t('acr.history.trendTitle')}
      </h3>
      <ul className="flex flex-col gap-1">
        {scored.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="w-24 shrink-0">{yearName(r.academic_year_id)}</span>
            <span
              role="img"
              aria-label={t('acr.history.trendLabel', {
                year: yearName(r.academic_year_id),
                total: formatNumber(r.total ?? 0, regionConfig),
              })}
              className="h-3 rounded-sm bg-primary"
              style={{ width: `${((r.total ?? 0) / max) * 100}%` }}
            />
            <span aria-hidden="true">{formatNumber(r.total ?? 0, regionConfig)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AcrTab({ userId }: AcrTabProps) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useRegionConfig();
  const query = useAcrStaffHistory(userId);
  const years = useAcademicYears({}).data?.data ?? [];
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const [startOpen, setStartOpen] = React.useState(false);
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? '—';

  const columns: DataTableColumn<AcrAssessment>[] = [
    {
      id: 'year',
      header: t('acr.history.columnYear'),
      accessorFn: (r) => yearName(r.academic_year_id),
      card: 'title',
    },
    {
      id: 'status',
      header: t('acr.history.columnStatus'),
      accessorFn: (r) => (
        <StatusBadge
          tone={r.status === 'COMPLETED' ? 'success' : 'warning'}
          label={t(`acr.status.${r.status}`)}
        />
      ),
      card: 'badge',
    },
    {
      id: 'total',
      header: t('acr.history.columnTotal'),
      align: 'end',
      accessorFn: (r) => (r.total === null ? '—' : formatNumber(r.total, regionConfig)),
    },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 md:px-5">
        <h2 className="text-h2">{t('acr.history.title')}</h2>
        {canWrite && (
          <Button type="button" variant="outline" onClick={() => setStartOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t('acr.start')}
          </Button>
        )}
      </div>
      <TabQueryState
        query={query}
        forbiddenMessage={t('forbidden')}
        errorMessage={t('acr.history.errorMessage')}
      >
        {(rows) => (
          <>
            <DataTable
              tableId="staff-acr-history"
              caption={t('acr.history.title')}
              columns={columns}
              data={rows}
              getRowId={(r) => r.id}
              sorting={null}
              onSortingChange={() => undefined}
              totalCount={rows.length}
              paginated={false}
              rowActions={(r) => [
                {
                  intent: 'view',
                  label: t('acr.register.open'),
                  to: `/staff/${userId}/acr/${r.id}`,
                },
              ]}
              emptyState={{ title: t('acr.history.title'), explanation: t('acr.history.empty') }}
            />
            <TrendBars rows={rows} yearName={yearName} />
          </>
        )}
      </TabQueryState>
      {canWrite && (
        <StartAcrDialog open={startOpen} onOpenChange={setStartOpen} staffUserId={userId} />
      )}
    </section>
  );
}
