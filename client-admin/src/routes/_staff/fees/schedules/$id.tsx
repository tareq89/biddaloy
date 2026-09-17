/**
 * `/fees/schedules/$id` — [16.7.5] detail page: exclusions management
 * (`-exclusions-table.tsx`) plus a run-history section reusing
 * `fee-generations`' own `BatchTable`/`BatchBillsDrawer` (wave 3, #654/
 * #655) rather than a bespoke history view.
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending } from '@biddaloy/ui/components';
import {
  recurringScheduleQueryOptions,
  useFeeGenerations,
  useHasPermission,
  useRecurringSchedule,
  type FeeGeneration,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { BatchBillsDrawer } from '../-generations/batch-bills-drawer';
import { BatchTable } from '../-generations/batch-table';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { ExclusionsTable } from './-exclusions-table';

export const Route = createFileRoute('/_staff/fees/schedules/$id')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(recurringScheduleQueryOptions(params.id))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: ScheduleDetailPending,
  component: ScheduleDetailPage,
});

/**
 * Run-history table. `GET /fees/generations` has no `recurring_schedule_id`
 * filter in the real, already-shipped `FeeGenerationListItemDto` (checked
 * against `server/src/modules/fees/dto/fee-generations.dto.ts` — this is
 * client-only territory, so that DTO isn't ours to extend here). Sending
 * an unrecognized filter param risks either being silently stripped
 * (showing every schedule's batches) or rejected outright by the
 * server's whitelist validation, so this scopes by the one filter that
 * *is* real and supported — `source: 'SCHEDULE'` — and says so in the
 * caption, rather than either lying about being scoped to just this
 * schedule or leaving the section unimplemented. Once a server ticket
 * adds `recurring_schedule_id` to `QueryFeeGenerationsDto`, swap the
 * filter here for a real one.
 */
function ScheduleRunHistory({ scheduleId }: { scheduleId: string }) {
  // Not sent to the server — see this function's own doc comment on why
  // `recurring_schedule_id` can't be used as a real filter param yet.
  void scheduleId;
  const { t } = useTranslation('fees');
  const [state, actions] = useListShellState({ limit: 10 });
  const generationsQuery = useFeeGenerations({
    source: 'SCHEDULE',
    page: state.page,
    limit: state.limit,
  });
  const [selectedBatch, setSelectedBatch] = React.useState<FeeGeneration | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('schedules.detail.runHistoryScopeNotice')}</p>
      <BatchTable
        title={t('schedules.detail.runHistoryTitle')}
        filters={{ fields: [], values: state.filters, onChange: actions.setFilters }}
        data={generationsQuery.data?.data ?? []}
        loading={generationsQuery.isLoading}
        isFetching={generationsQuery.isFetching}
        {...(generationsQuery.isError ? { error: t('schedules.errorMessage') } : {})}
        emptyMessage={t('schedules.detail.runHistoryEmptyMessage')}
        page={state.page}
        pageSize={state.limit}
        totalCount={generationsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        onRowClick={setSelectedBatch}
      />
      <BatchBillsDrawer
        batch={selectedBatch}
        onOpenChange={(open) => !open && setSelectedBatch(null)}
      />
    </div>
  );
}

function ScheduleDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation('fees');
  const canManage = useHasPermission(Permission.SCHEDULE_MANAGE);

  const scheduleQuery = useRecurringSchedule(id);
  // KNOWN SERVER GAP (#675): `RecurringScheduleResponseDto` carries no
  // `exclusions`, and there is no `GET /fees/schedules/:id/exclusions`, so
  // this list is always empty today — adding and removing exclusions works,
  // reading them back does not. See `RecurringScheduleExclusion` in
  // `ui/src/hooks/recurring-schedules.ts`.
  const exclusions = scheduleQuery.data?.exclusions ?? [];

  if (scheduleQuery.isLoading) return <ScheduleDetailPending />;
  if (scheduleQuery.isError || !scheduleQuery.data) {
    return <p className="text-sm text-destructive">{t('schedules.errorMessage')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/fees/schedules"
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {t('schedules.detail.back')}
          </Link>
          <h1 className="text-lg font-semibold">{scheduleQuery.data.name}</h1>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t('schedules.detail.exclusionsTitle')}</h2>
        <ExclusionsTable scheduleId={id} exclusions={exclusions} canManage={canManage} />
      </section>

      <section className="flex flex-col gap-3">
        <ScheduleRunHistory scheduleId={id} />
      </section>
    </div>
  );
}

function ScheduleDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
