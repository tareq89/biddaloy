/**
 * [25.7] Seat plan detail — room-by-room seating, reseat, reshuffle,
 * invigilator assignment, publish; redesigned in [31.4.exams-4b]. A `DetailShell`
 * without tabs: the header holds the status badge, four facts and (for a
 * DRAFT plan) the one primary "Publish". One subject sitting is shown at a
 * time (`?sitting=`), because every student is seated once per sitting.
 *
 * Once the plan is PUBLISHED every edit control (reseat, reshuffle,
 * invigilator, and the Publish button itself) is hidden — the server already
 * refuses these mutations post-publish (`getDraftPlanOrThrow`); a disabled
 * filled button would only read as broken.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  seatPlanDetailQueryOptions,
  useRooms,
  useReshuffleRoom,
  useSeatPlanDetail,
  useHasPermission,
  type SeatPlanAllocationRow,
  type SeatPlanRoomDetail,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, parseDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { DoorOpen, Lock, Megaphone, Shuffle } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { subjectLabel } from '../-detail/subject-label';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { InvigilatorPicker } from './-invigilator-picker';
import { PublishSeatPlanDialog } from './-publish-dialog';
import { ReseatDialog } from './-reseat-dialog';
import { SeatPlanStatusBadge } from './-seat-plan-status-badge';

// The subject sitting shown (`?sitting=<exam_schedule_id>`); unknown values fall back to the first.
const seatPlanSearchSchema = z.object({
  sitting: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/exams/seat-plans/$planId')({
  validateSearch: seatPlanSearchSchema,
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

const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';

function roomName(room: Pick<SeatPlanRoomDetail, 'room_no' | 'building'>): string {
  if (!room.room_no) return '—';
  return room.building ? `${room.building} — ${room.room_no}` : room.room_no;
}

function SeatPlanDetailPage() {
  const { planId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t, i18n } = useTranslation('seatPlansDetail');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.SEAT_PLAN_MANAGE);

  const planQuery = useSeatPlanDetail(planId);
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data?.data ?? [];
  const reshuffleRoom = useReshuffleRoom(planId);

  const [reseatTarget, setReseatTarget] = React.useState<SeatPlanAllocationRow | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [reshuffleTarget, setReshuffleTarget] = React.useState<SeatPlanRoomDetail | null>(null);

  React.useEffect(() => {
    document.title = planQuery.data ? `${planQuery.data.name} · SchoolManager` : 'SchoolManager';
  }, [planQuery.data]);

  if (planQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-7 w-72" />
        <div className="flex gap-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (planQuery.isError)
    return <ErrorState message={t('detail.loadError')} onRetry={() => void planQuery.refetch()} />;

  const plan = planQuery.data;
  const isDraft = plan.status === 'DRAFT';
  const editable = canManage && isDraft;

  // One entry per subject sitting of the plan (the same student is seated once per sitting).
  const sittings = new Map<string, { id: string; label: string }>();
  for (const room of plan.rooms) {
    for (const a of room.allocations) {
      if (sittings.has(a.exam_schedule_id)) continue;
      const subject = subjectLabel({ name_en: a.subject_name, name_bn: a.subject_name_bn }, i18n.language);
      sittings.set(a.exam_schedule_id, {
        id: a.exam_schedule_id,
        label: a.exam_date
          ? `${subject} · ${formatDate(parseDate(a.exam_date.slice(0, 10)), config)}`
          : subject,
      });
    }
  }
  const sittingList = [...sittings.values()].sort((a, b) => a.label.localeCompare(b.label));
  const sittingId = sittingList.some((s) => s.id === search.sitting)
    ? search.sitting
    : sittingList[0]?.id;

  const count = (n: number, key: 'detail.countItems' | 'detail.countPeople') =>
    t(key, { count: formatNumber(n, config) });

  return (
    <>
      <DetailShell
        name={plan.name}
        statusBadge={<SeatPlanStatusBadge status={plan.status} ns="seatPlansDetail" />}
        facts={[
          { label: t('detail.facts.subjects'), value: count(plan.schedule_count, 'detail.countItems') },
          { label: t('detail.facts.rooms'), value: count(plan.room_count, 'detail.countItems') },
          { label: t('detail.facts.students'), value: count(plan.student_count, 'detail.countPeople') },
          { label: t('detail.facts.seatOrder'), value: t(`detail.seatOrder.${plan.seat_order_mode}`) },
        ]}
        actions={[
          {
            id: 'publish',
            label: t('detail.publishButton'),
            icon: <Megaphone aria-hidden className="size-4" />,
            priority: 'primary',
            allowed: editable,
            onClick: () => setPublishOpen(true),
          },
        ]}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          {sittingList.length > 1 && (
            <div className="flex flex-col gap-1.5 md:w-80">
              <Label htmlFor="seat-plan-sitting">{t('detail.sittingLabel')}</Label>
              <Select
                value={sittingId ?? ''}
                onValueChange={(value) =>
                  void navigate({ search: { sitting: value }, replace: true })
                }
              >
                <SelectTrigger id="seat-plan-sitting" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sittingList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isDraft ? (
            <p className="text-text-secondary md:ms-auto md:text-end">{t('detail.draftHint')}</p>
          ) : (
            <p
              role="status"
              className="flex items-center gap-2 text-text-secondary md:ms-auto md:text-end"
            >
              <Lock aria-hidden className="size-4 shrink-0" />
              {t('detail.publishedBanner')}
            </p>
          )}
        </div>

        {plan.rooms.map((room) => {
          const rows = room.allocations
            .filter((a) => a.exam_schedule_id === sittingId)
            .sort((a, b) =>
              a.seat_number.localeCompare(b.seat_number, undefined, { numeric: true }),
            );
          return (
            <section key={room.room_id} className={`${CARD} overflow-hidden`}>
              <div className="flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between md:p-5">
                <div>
                  <h2 className="text-h2">{roomName(room)}</h2>
                  <p className="mt-1 text-text-secondary">
                    {t('room.seated', {
                      count: formatNumber(rows.length, config),
                      capacity:
                        room.capacity === null
                          ? '—'
                          : t('room.capacity', { capacity: formatNumber(room.capacity, config) }),
                    })}
                  </p>
                </div>
                {editable ? (
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`invigilator-${room.room_id}`}>
                        {t('room.invigilatorLabel')}
                      </Label>
                      <InvigilatorPicker
                        id={`invigilator-${room.room_id}`}
                        planId={planId}
                        roomId={room.room_id}
                        invigilatorUserId={room.invigilator_user_id}
                        disabled={false}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full md:w-auto"
                      loading={reshuffleRoom.isPending && reshuffleRoom.variables === room.room_id}
                      onClick={() => setReshuffleTarget(room)}
                    >
                      <Shuffle aria-hidden className="size-4" />
                      {t('room.reshuffleButton')}
                    </Button>
                  </div>
                ) : (
                  <dl>
                    <dt className="text-caption text-text-secondary">
                      {t('room.invigilatorLabel')}
                    </dt>
                    <dd className="font-medium">
                      {room.invigilator_name ?? t('room.invigilatorNone')}
                    </dd>
                  </dl>
                )}
              </div>

              {rows.length === 0 ? (
                <p className="border-t border-border-subtle px-4 py-6 text-text-secondary">
                  {t('room.empty')}
                </p>
              ) : (
                <DataTable
                  tableId={`seat-plan-room-${room.room_id}`}
                  caption={t('room.tableCaption', { room: room.room_no ?? '' })}
                  paginated={false}
                  columns={[
                    {
                      id: 'seat',
                      header: t('room.columnSeat'),
                      accessorFn: (row) =>
                        /^\d+$/.test(row.seat_number)
                          ? formatNumber(Number(row.seat_number), config)
                          : row.seat_number,
                      align: 'end',
                    },
                    {
                      id: 'student',
                      header: t('room.columnStudent'),
                      accessorFn: (row) => row.student_name,
                      card: 'title',
                    },
                    {
                      id: 'section',
                      header: t('room.columnSection'),
                      accessorFn: (row) => row.section_name ?? '—',
                    },
                    {
                      id: 'roll',
                      header: t('room.columnRoll'),
                      accessorFn: (row) => formatNumber(row.roll_number, config),
                      align: 'end',
                    },
                  ]}
                  {...(editable
                    ? {
                        rowActions: (row: SeatPlanAllocationRow) => [
                          {
                            intent: 'edit' as const,
                            label: t('room.reseatButton', { name: row.student_name }),
                            onClick: () => setReseatTarget(row),
                          },
                        ],
                      }
                    : {})}
                  data={rows}
                  getRowId={(row) => row.id}
                  sorting={null}
                  onSortingChange={() => {}}
                  page={1}
                  pageSize={Math.max(rows.length, 1)}
                  totalCount={rows.length}
                  onPageChange={() => {}}
                />
              )}
            </section>
          );
        })}

        {plan.rooms.length === 0 && (
          <EmptyState icon={<DoorOpen aria-hidden className="size-6" />} title={t('detail.noRooms')} explanation={t('detail.noRoomsText')} />
        )}
      </DetailShell>

      <ReseatDialog
        open={reseatTarget !== null}
        onOpenChange={(open) => !open && setReseatTarget(null)}
        planId={planId}
        allocation={reseatTarget}
        rooms={rooms}
      />
      <PublishSeatPlanDialog open={publishOpen} onOpenChange={setPublishOpen} planId={planId} />
      <ConfirmDialog
        open={reshuffleTarget !== null}
        onOpenChange={(open) => !open && setReshuffleTarget(null)}
        tone="default"
        title={t('reshuffle.title')}
        description={t('reshuffle.description', {
          room: reshuffleTarget ? roomName(reshuffleTarget) : '',
        })}
        confirmLabel={t('reshuffle.confirm')}
        busy={reshuffleRoom.isPending}
        onConfirm={() =>
          reshuffleTarget &&
          reshuffleRoom.mutate(reshuffleTarget.room_id, {
            onSuccess: () => setReshuffleTarget(null),
          })
        }
      />
    </>
  );
}

function SeatPlanDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
