/**
 * [25.7] Seat plan detail — room-by-room seating, reseat, reshuffle,
 * invigilator assignment, publish. One section per room (no tabs — there
 * is only one view here, unlike `exams/$examId.tsx`'s multi-tab shell).
 *
 * Once the plan is PUBLISHED every edit control (reseat, reshuffle,
 * invigilator, and the Publish button itself) is disabled — the server
 * already refuses these mutations post-publish (`getDraftPlanOrThrow`),
 * this just keeps the screen from offering controls that would 409.
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, RoutePending, Skeleton, Button } from '@biddaloy/ui/components';
import {
  seatPlanDetailQueryOptions,
  useRooms,
  useReshuffleRoom,
  useSeatPlanDetail,
  useHasPermission,
  type SeatPlanAllocationRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { InvigilatorPicker } from './-invigilator-picker';
import { PublishSeatPlanDialog } from './-publish-dialog';
import { ReseatDialog } from './-reseat-dialog';

export const Route = createFileRoute('/_staff/exams/seat-plans/$planId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(seatPlanDetailQueryOptions(params.planId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('seatPlansDetail', 'common'),
    ]),
  pendingComponent: SeatPlanDetailPending,
  component: SeatPlanDetailPage,
});

function SeatPlanDetailPage() {
  const { planId } = Route.useParams();
  const { t } = useTranslation('seatPlansDetail');
  const canManage = useHasPermission(Permission.SEAT_PLAN_MANAGE);

  const planQuery = useSeatPlanDetail(planId);
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data?.data ?? [];
  const reshuffleRoom = useReshuffleRoom(planId);

  const [reseatTarget, setReseatTarget] = React.useState<SeatPlanAllocationRow | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);

  React.useEffect(() => {
    document.title = planQuery.data ? `${planQuery.data.name} · SchoolManager` : 'SchoolManager';
  }, [planQuery.data]);

  if (planQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (planQuery.isError)
    return <ErrorState message={t('detail.loadError')} onRetry={() => void planQuery.refetch()} />;

  const plan = planQuery.data;
  const isDraft = plan.status === 'DRAFT';
  const editable = canManage && isDraft;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/exams/seat-plans"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
        {t('detail.back')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{plan.name}</h1>
          <p className="text-sm text-muted-foreground">{t(`status.${plan.status}`)}</p>
        </div>
        {canManage && (
          <Button type="button" disabled={!isDraft} onClick={() => setPublishOpen(true)}>
            {t('detail.publishButton')}
          </Button>
        )}
      </div>

      {!isDraft && (
        <p role="status" className="rounded-md border border-border-subtle p-3 text-sm">
          {t('detail.publishedBanner')}
        </p>
      )}

      <div className="flex flex-col gap-6">
        {plan.rooms.map((room) => (
          <section key={room.room_id} className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">
                  {room.building ? `${room.building} — ${room.room_no}` : room.room_no}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('room.capacity', { capacity: room.capacity ?? 0 })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <InvigilatorPicker
                  planId={planId}
                  roomId={room.room_id}
                  invigilatorUserId={room.invigilator_user_id}
                  disabled={!editable}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!editable}
                  loading={reshuffleRoom.isPending && reshuffleRoom.variables === room.room_id}
                  onClick={() => reshuffleRoom.mutate(room.room_id)}
                >
                  {t('room.reshuffleButton')}
                </Button>
              </div>
            </div>

            {/* Desktop/tablet: table. Phone (< sm): card-per-student list (issue step 7). */}
            <table className="hidden w-full text-sm sm:table">
              <caption className="sr-only">
                {t('room.tableCaption', { room: room.room_no ?? '' })}
              </caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">{t('room.columnStudent')}</th>
                  <th className="py-2">{t('room.columnSection')}</th>
                  <th className="py-2">{t('room.columnRoll')}</th>
                  <th className="py-2">{t('room.columnSeat')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {room.allocations.map((allocation) => (
                  <tr key={allocation.id} className="border-b">
                    <td className="py-2">{allocation.student_name}</td>
                    <td className="py-2">{allocation.section_name ?? ''}</td>
                    <td className="py-2">{allocation.roll_number ?? ''}</td>
                    <td className="py-2">{allocation.seat_number}</td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!editable}
                        onClick={() => setReseatTarget(allocation)}
                      >
                        {t('room.reseatButton')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="flex flex-col gap-2 sm:hidden">
              {room.allocations.map((allocation) => (
                <li
                  key={allocation.id}
                  className="flex flex-col gap-1 rounded-md border p-3 text-sm"
                >
                  <span className="font-medium">{allocation.student_name}</span>
                  <span className="text-muted-foreground">
                    {allocation.section_name ?? ''}
                    {allocation.roll_number !== null ? ` · ${allocation.roll_number}` : ''}
                  </span>
                  <span>{t('room.seatLabel', { seat: allocation.seat_number })}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!editable}
                    onClick={() => setReseatTarget(allocation)}
                  >
                    {t('room.reseatButton')}
                  </Button>
                </li>
              ))}
            </ul>

            {room.allocations.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('room.empty')}</p>
            )}
          </section>
        ))}

        {plan.rooms.length === 0 && <p className="text-muted-foreground">{t('detail.noRooms')}</p>}
      </div>

      <ReseatDialog
        open={reseatTarget !== null}
        onOpenChange={(open) => !open && setReseatTarget(null)}
        planId={planId}
        allocation={reseatTarget}
        rooms={rooms}
      />
      <PublishSeatPlanDialog open={publishOpen} onOpenChange={setPublishOpen} planId={planId} />
    </div>
  );
}

function SeatPlanDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
