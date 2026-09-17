/**
 * `/fees/schedules/$id` — [16.7.5] detail page: exclusions management
 * (`-exclusions-table.tsx`) plus a run-history section reusing
 * `fee-generations`' batch list, filtered to this schedule's batches —
 * same data `fees/generate.tsx`'s log shows, scoped by
 * `recurring_schedule_id` per issue #679's contract table, rather than
 * a second bespoke history view.
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending } from '@biddaloy/ui/components';
import {
  recurringScheduleQueryOptions,
  useHasPermission,
  useRecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';

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

function ScheduleDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation('fees');
  const canManage = useHasPermission(Permission.FEE_GENERATE);

  const scheduleQuery = useRecurringSchedule(id);
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
        <h2 className="text-base font-medium">{t('schedules.detail.runHistoryTitle')}</h2>
        {/* [16.7.5]: `GET /fee-generations` has no `recurring_schedule_id`
         * filter in this interim contract yet — #675/#654's batch log
         * would need that param added server-side to scope a real list
         * here. Left as an explicit gap rather than a client-side filter
         * over the unscoped list (which would silently show every
         * school's batches, not just this schedule's). */}
        <p className="text-sm text-muted-foreground">
          {t('schedules.detail.runHistoryEmptyMessage')}
        </p>
      </section>
    </div>
  );
}

function ScheduleDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
