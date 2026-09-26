/**
 * Seat plans list — [25.6]. Same list-shell shape `exams/index.tsx` and
 * `fees/generate.tsx` use: a `ListShell` over `useListShellState` plus a
 * "Generate seat plan" button that opens `GenerateSeatPlanModal` inline
 * (there is no separate `/generate` route the way fees has one — the
 * modal is small enough to live on this page directly).
 *
 * The modal's open state is a `?generate=1` search param, not local
 * `useState` — same pattern `payments/index.tsx`'s `record` param uses —
 * so `action-registry.ts`'s "Generate seat plan" palette action can open
 * it by navigating here with the param set, per U7 (never a second copy
 * of the form/modal).
 *
 * `GET /seat-plans` has no pagination of its own (`SeatPlansService
 * .findAll` returns every plan for the tenant) — client-side slicing here
 * keeps `ListShell`'s pager contract without a server change this ticket
 * doesn't need.
 */
import { Permission } from '@biddaloy/shared';
import { Button, RoutePending } from '@biddaloy/ui/components';
import { seatPlansQueryOptions, useHasPermission, useSeatPlans } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { GenerateSeatPlanModal } from './-generate-seat-plan-modal';

const seatPlansSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // this page has no bulk actions, but the schema still has to declare it
  // or `validateSearch` strips it, same reasoning `fees/generate.tsx` gives.
  selected: z.string().optional().catch(undefined),
  // `'1'` opens the modal — see `payments/index.tsx`'s identical `record`
  // param for why this is `z.coerce.string()`, not `z.string()`.
  generate: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/exams/seat-plans/')({
  validateSearch: seatPlansSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(seatPlansQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('seatPlans', 'common'),
    ]),
  pendingComponent: SeatPlansListPending,
  component: SeatPlansListPage,
});

function SeatPlansListPage() {
  const { t } = useTranslation('seatPlans');
  const [state, actions] = useListShellState({ limit: 20 });
  const canManage = useHasPermission(Permission.SEAT_PLAN_MANAGE);
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const seatPlansQuery = useSeatPlans();
  const allRows = seatPlansQuery.data ?? [];
  const start = (state.page - 1) * state.limit;
  const rows = allRows.slice(start, start + state.limit);

  function setGenerateOpen(open: boolean) {
    void navigate({
      search: (prev) => (open ? { ...prev, generate: '1' } : { ...prev, generate: undefined }),
    });
  }

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setGenerateOpen(true)}>
              {t('list.generateButton')}
            </Button>
          )
        }
        tableId="seat-plans-list"
        caption={t('list.caption')}
        columns={[
          {
            id: 'name',
            header: t('list.columnName'),
            accessorFn: (row) => row.name,
          },
          {
            id: 'status',
            header: t('list.columnStatus'),
            accessorFn: (row) => t(`status.${row.status}`),
          },
          {
            id: 'scheduleCount',
            header: t('list.columnScheduleCount'),
            accessorFn: (row) => row.schedule_count,
          },
          {
            id: 'roomCount',
            header: t('list.columnRoomCount'),
            accessorFn: (row) => row.room_count,
          },
          {
            id: 'studentCount',
            header: t('list.columnStudentCount'),
            accessorFn: (row) => row.student_count,
          },
        ]}
        data={rows}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={allRows.length}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={seatPlansQuery.isLoading}
        isFetching={seatPlansQuery.isFetching}
        {...(seatPlansQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
      />

      {canManage && (
        <GenerateSeatPlanModal open={search.generate === '1'} onOpenChange={setGenerateOpen} />
      )}
    </>
  );
}

function SeatPlansListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
