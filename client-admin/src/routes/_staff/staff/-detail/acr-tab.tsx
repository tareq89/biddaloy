/**
 * [28.4.2] Staff detail › ACR tab: per-year history, a Start ACR button
 * (ACR_WRITE) and small year-over-year bars (plain CSS, D24). Mounted only
 * behind ACR_READ by `$userId.tsx`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, EmptyState } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAcrStaffHistory,
  useHasPermission,
  type AcrAssessment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
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
  const scored = rows.filter((r) => r.total !== null);
  // ponytail: bars scale to this staff member's best year, not the form's
  // theoretical maximum; switch when the max score is exposed by the API.
  const max = Math.max(...scored.map((r) => r.total ?? 0), 1);
  if (scored.length < 2) return null;
  return (
    <section aria-labelledby="acr-trend-title" className="flex flex-col gap-2">
      <h3 id="acr-trend-title" className="text-sm font-semibold">
        {t('acr.history.trendTitle')}
      </h3>
      <ul className="flex flex-col gap-1">
        {scored.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0">{yearName(r.academic_year_id)}</span>
            <span
              role="img"
              aria-label={t('acr.history.trendLabel', {
                year: yearName(r.academic_year_id),
                total: r.total,
              })}
              className="h-3 rounded bg-primary"
              style={{ width: `${((r.total ?? 0) / max) * 100}%` }}
            />
            <span aria-hidden="true">{r.total}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AcrTab({ userId }: AcrTabProps) {
  const { t } = useTranslation('evaluations');
  const query = useAcrStaffHistory(userId);
  const years = useAcademicYears({}).data?.data ?? [];
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const [startOpen, setStartOpen] = React.useState(false);
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('acr.history.title')}</h2>
        {canWrite && (
          <Button type="button" onClick={() => setStartOpen(true)}>
            {t('acr.start')}
          </Button>
        )}
      </div>
      <TabQueryState
        query={query}
        forbiddenMessage={t('forbidden')}
        errorMessage={t('acr.history.errorMessage')}
      >
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title={t('acr.history.title')} explanation={t('acr.history.empty')} />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <span className="font-medium">{yearName(r.academic_year_id)}</span>
                    <span>{t(`acr.status.${r.status}`)}</span>
                    <span>{r.total ?? '—'}</span>
                    <Link
                      to="/staff/$userId/acr/$assessmentId"
                      params={{ userId, assessmentId: r.id }}
                      className="inline-flex min-h-6 items-center text-primary underline"
                    >
                      {t('acr.register.open')}
                    </Link>
                  </li>
                ))}
              </ul>
              <TrendBars rows={rows} yearName={yearName} />
            </>
          )
        }
      </TabQueryState>
      {canWrite && (
        <StartAcrDialog open={startOpen} onOpenChange={setStartOpen} staffUserId={userId} />
      )}
    </div>
  );
}
