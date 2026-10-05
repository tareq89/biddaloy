/**
 * [25.6] "Generate seat plan" full page (`?generate=1`, [31.4.exams-4a]): pick an
 * exam (to scope which subject sittings are on offer, since there's no
 * cross-exam schedule listing endpoint — `GET /exams/:examId/schedule` is
 * per-exam, see `ui/src/hooks/exams.ts`'s `useExamSchedule`), multi-select the
 * sittings and rooms, pick a seat-order mode, and submit to
 * `POST /seat-plans/generate`. It holds two selectable lists, so it is a
 * `FullPageShell`, not a dialog. Mounted only while open, so its state resets
 * by itself.
 *
 * Feedback paths (D4/D5):
 * - 400 `SEAT_CAPACITY_SHORTFALL` (`details.code`, see `ui/src/hooks
 *   /seat-plans.ts`): shown inline with the shortfall and suggested rooms,
 *   each with an "Add" button that checks it into the room list so retry
 *   is a single click, no need to leave the page.
 * - A successful generate can still carry non-empty `conflicts` (room/time
 *   overlaps with another PUBLISHED plan, D5) — the plan is already
 *   created at that point (the server only *warns*, per `checkRoomConflicts`
 *   `seat-plans.service.ts`), so the conflicts are listed by room and plan
 *   name on the way to opening the plan. No conflicts: straight to the plan.
 * - Any other failure shows one translated line, never the server text.
 */
import { ApiError, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  useExamSchedule,
  useExams,
  useGenerateSeatPlan,
  useRooms,
  useSeatPlans,
  type GenerateSeatPlanResult,
  type SeatCapacityShortfallDetails,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber, formatTime, formatDate, parseDate } from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { subjectLabel } from '../-detail/subject-label';

export interface GenerateSeatPlanModalProps {
  /** Closing drops `?generate=1` — the list page owns that. */
  onClose: () => void;
}

const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1 p-4 md:p-5';
const ROW = 'flex min-h-11 w-full items-center gap-3 py-2 md:min-h-8';
const GHOST =
  'inline-flex h-11 items-center rounded-md px-2 text-label font-medium text-primary hover:bg-muted md:h-8';
// Asterisk drawn by CSS, so the label text stays exactly the field name.
const REQUIRED = "after:ms-0.5 after:text-destructive after:content-['*']";

/** `Room` has no `name` field (`room_no` + optional `building`) — this is
 * the one display label used everywhere in this page so a room's line
 * always reads the same whether it's the checkbox list or a suggestion. */
function roomLabel(room: { room_no: string; building: string | null } | undefined): string {
  if (!room) return '';
  return room.building ? `${room.building} — ${room.room_no}` : room.room_no;
}

function isShortfallDetails(details: unknown): details is SeatCapacityShortfallDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'SEAT_CAPACITY_SHORTFALL'
  );
}

export function GenerateSeatPlanModal({ onClose }: GenerateSeatPlanModalProps) {
  const { t, i18n } = useTranslation('seatPlans');
  const { t: tc } = useTranslation('common');
  const config = useRegionConfig();
  const navigate = useNavigate();

  const [name, setName] = React.useState('');
  const [examId, setExamId] = React.useState('');
  const [selectedSchedules, setSelectedSchedules] = React.useState<Set<string>>(new Set());
  const [selectedRooms, setSelectedRooms] = React.useState<Set<string>>(new Set());
  const [seatOrderMode, setSeatOrderMode] = React.useState<'SEQUENTIAL' | 'RANDOM'>('SEQUENTIAL');
  const [result, setResult] = React.useState<GenerateSeatPlanResult | null>(null);
  // Set on success: clears `dirty` first, so the unsaved-changes guard lets the navigation through.
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [openPlanId, setOpenPlanId] = React.useState<string | null>(null);

  const examsQuery = useExams({ limit: 100 });
  const exams = examsQuery.data?.data ?? [];
  const scheduleQuery = useExamSchedule(examId || undefined);
  const schedules = scheduleQuery.data ?? [];
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data?.data ?? [];
  const plansQuery = useSeatPlans();

  const generate = useGenerateSeatPlan();

  React.useEffect(() => {
    if (openPlanId) {
      void navigate({ to: '/exams/seat-plans/$planId', params: { planId: openPlanId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate once, when the id is set
  }, [openPlanId]);

  function toggleSchedule(id: string, checked: boolean) {
    const next = new Set(selectedSchedules);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedSchedules(next);
  }

  function toggleRoom(id: string, checked: boolean) {
    const next = new Set(selectedRooms);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedRooms(next);
  }

  const canSubmit =
    name.trim() !== '' &&
    selectedSchedules.size > 0 &&
    selectedRooms.size > 0 &&
    !generate.isPending;
  const dirty =
    openPlanId === null &&
    result === null &&
    (name.trim() !== '' || examId !== '' || selectedSchedules.size > 0 || selectedRooms.size > 0);

  function submit() {
    if (!canSubmit) return;
    const notifyTenantId = captureNotificationTenant();
    generate.mutate(
      {
        name: name.trim(),
        exam_schedule_ids: Array.from(selectedSchedules),
        room_ids: Array.from(selectedRooms),
        seat_order_mode: seatOrderMode,
      },
      {
        onSuccess: (data) => {
          if (data.conflicts.length === 0) {
            notifyOutcome({
              tenantId: notifyTenantId,
              variant: 'success',
              message: t('generate.success'),
            });
            setOpenPlanId(data.plan.id);
          } else {
            setResult(data);
          }
        },
      },
    );
  }

  const shortfall =
    generate.error instanceof ApiError && isShortfallDetails(generate.error.details)
      ? generate.error.details
      : undefined;
  const genericError = generate.error && !shortfall ? t('errors.unknown') : undefined;

  const seatsSelected = rooms
    .filter((room) => selectedRooms.has(room.id))
    .reduce((sum, room) => sum + (room.capacity ?? 0), 0);

  // --- Result: the plan exists, some rooms clash with another published plan ---
  if (result) {
    const planName = (id: string) =>
      plansQuery.data?.find((plan) => plan.id === id)?.name ?? t('generate.otherPlan');
    return (
      <FullPageShell
        title={t('generate.title')}
        size="form"
        onClose={onClose}
        secondary={{ label: t('generate.close'), onClick: onClose }}
        primary={{ label: t('generate.acknowledge'), onClick: () => setOpenPlanId(result.plan.id) }}
      >
        <section className={CARD}>
          <StatusBadge tone="warning" label={t('generate.conflictBadge')} />
          <p role="alert" className="mt-2">
            {t('generate.conflictsNotice', { count: result.conflicts.length, n: formatNumber(result.conflicts.length, config) })}
          </p>
          <ul className="mt-3 divide-y divide-border-subtle">
            {result.conflicts.map((conflict, index) => (
              <li key={index} className="py-3">
                {t('generate.conflictLine', {
                  room: roomLabel(rooms.find((r) => r.id === conflict.room_id)) || '—',
                  plan: planName(conflict.conflicting_seat_plan_id),
                })}
              </li>
            ))}
          </ul>
        </section>
      </FullPageShell>
    );
  }

  const allSchedulesSelected =
    schedules.length > 0 && schedules.every((s) => selectedSchedules.has(s.id));
  const allRoomsSelected = rooms.length > 0 && rooms.every((r) => selectedRooms.has(r.id));

  return (
    <FullPageShell
      title={t('generate.title')}
      size="form"
      dirty={dirty}
      onClose={onClose}
      secondary={{
        label: t('generate.cancel'),
        onClick: () => (dirty ? setConfirmCancel(true) : onClose()),
      }}
      primary={{
        label: t('generate.submit'),
        onClick: submit,
        busy: generate.isPending,
        disabled: !canSubmit,
      }}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          tone="danger"
          title={tc('fullPage.discardTitle')}
          description={tc('fullPage.discardDescription')}
          confirmLabel={tc('fullPage.discardConfirm')}
          cancelLabel={tc('fullPage.keepEditing')}
          onConfirm={() => {
            setConfirmCancel(false);
            onClose();
          }}
        />
        <p className="text-text-secondary">{t('generate.description')}</p>

        <section className={CARD}>
          <h2 className="text-h2">{t('generate.detailsCard')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seat-plan-name" className={REQUIRED}>
                {t('generate.nameLabel')}
              </Label>
              <Input
                id="seat-plan-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seat-plan-exam" className={REQUIRED}>
                {t('generate.examLabel')}
              </Label>
              <Select
                value={examId}
                onValueChange={(value) => {
                  setExamId(value);
                  setSelectedSchedules(new Set());
                }}
              >
                <SelectTrigger id="seat-plan-exam" className="w-full">
                  <SelectValue placeholder={t('generate.examPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.class?.name ? `${exam.name} · ${exam.class.name}` : exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="md:col-span-2">
              <legend className="text-label">{t('generate.seatOrderLabel')}</legend>
              <RadioGroup
                value={seatOrderMode}
                onValueChange={(value) => setSeatOrderMode(value as 'SEQUENTIAL' | 'RANDOM')}
                aria-label={t('generate.seatOrderLabel')}
                className="mt-1 grid gap-x-6 md:grid-cols-2"
              >
                {(
                  [
                    ['SEQUENTIAL', 'seatOrderSequential', 'seatOrderSequentialHelp'],
                    ['RANDOM', 'seatOrderRandom', 'seatOrderRandomHelp'],
                  ] as const
                ).map(([value, label, help]) => (
                  <label
                    key={value}
                    htmlFor={`seat-order-${value}`}
                    className="flex min-h-11 items-start gap-3 py-2 md:min-h-8"
                  >
                    <RadioGroupItem id={`seat-order-${value}`} value={value} className="mt-0.5" />
                    <span className="flex flex-col">
                      <span>{t(`generate.${label}`)}</span>
                      <span className="text-caption text-text-secondary">
                        {t(`generate.${help}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
        </section>

        <section className={CARD} data-testid="schedule-picker">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className={`text-h2 ${REQUIRED}`}>{t('generate.schedulesLabel')}</h2>
              <p className="mt-1 text-text-secondary">
                {t('generate.selectedCount', {
                  n: formatNumber(selectedSchedules.size, config),
                })}
              </p>
            </div>
            {schedules.length > 0 && (
              <button
                type="button"
                className={GHOST}
                onClick={() =>
                  setSelectedSchedules(
                    allSchedulesSelected ? new Set() : new Set(schedules.map((s) => s.id)),
                  )
                }
              >
                {allSchedulesSelected ? t('generate.clearAll') : t('generate.selectAll')}
              </button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-border-subtle">
            {examId === '' && (
              <li className="py-2 text-text-secondary">{t('generate.schedulesPickExamFirst')}</li>
            )}
            {examId !== '' && scheduleQuery.isPending && (
              <>
                <li>
                  <Skeleton className="my-2 h-6 w-full" />
                </li>
                <li>
                  <Skeleton className="my-2 h-6 w-full" />
                </li>
                <li>
                  <Skeleton className="my-2 h-6 w-full" />
                </li>
              </>
            )}
            {examId !== '' && scheduleQuery.isSuccess && schedules.length === 0 && (
              <li className="py-2 text-text-secondary">{t('generate.schedulesEmpty')}</li>
            )}
            {schedules.map((schedule) => {
              const subject = schedule.subject
                ? subjectLabel(schedule.subject, i18n.language)
                : '—';
              return (
                <li key={schedule.id}>
                  <label htmlFor={`schedule-${schedule.id}`} className={ROW}>
                    <Checkbox
                      id={`schedule-${schedule.id}`}
                      checked={selectedSchedules.has(schedule.id)}
                      onCheckedChange={(checked) => toggleSchedule(schedule.id, checked === true)}
                      aria-label={subject}
                    />
                    <span className="flex flex-col">
                      <span>{subject}</span>
                      <span className="text-caption text-text-secondary">
                        {t('generate.scheduleCaption', {
                          date: formatDate(parseDate(schedule.date.slice(0, 10)), config),
                          from: formatTime(schedule.starts_at, config),
                          to: formatTime(schedule.ends_at, config),
                        })}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={CARD} data-testid="room-picker">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className={`text-h2 ${REQUIRED}`}>{t('generate.roomsLabel')}</h2>
              <p className="mt-1 text-text-secondary">
                {t('generate.roomsSummary', {
                  n: formatNumber(selectedRooms.size, config),
                  seats: formatNumber(seatsSelected, config),
                })}
              </p>
            </div>
            {rooms.length > 0 && (
              <button
                type="button"
                className={GHOST}
                onClick={() =>
                  setSelectedRooms(allRoomsSelected ? new Set() : new Set(rooms.map((r) => r.id)))
                }
              >
                {allRoomsSelected ? t('generate.clearAll') : t('generate.selectAll')}
              </button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-border-subtle">
            {roomsQuery.isPending && (
              <>
                <li>
                  <Skeleton className="my-2 h-6 w-full" />
                </li>
                <li>
                  <Skeleton className="my-2 h-6 w-full" />
                </li>
              </>
            )}
            {roomsQuery.isSuccess && rooms.length === 0 && (
              <li className="py-2 text-text-secondary">{t('generate.roomsEmpty')}</li>
            )}
            {rooms.map((room) => (
              <li key={room.id}>
                <label htmlFor={`room-${room.id}`} className={ROW}>
                  <Checkbox
                    id={`room-${room.id}`}
                    checked={selectedRooms.has(room.id)}
                    onCheckedChange={(checked) => toggleRoom(room.id, checked === true)}
                    aria-label={roomLabel(room)}
                  />
                  {roomLabel(room)}
                  <span className="ms-auto shrink-0 text-text-secondary">
                    {t('generate.roomCapacity', {
                      capacity: formatNumber(room.capacity ?? 0, config),
                    })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        {shortfall && (
          <div
            role="alert"
            className="rounded-lg border border-destructive bg-surface p-4 md:p-5"
          >
            <p>
              {t('generate.shortfallMessage', {
                needed: formatNumber(shortfall.seats_needed, config),
                available: formatNumber(shortfall.seats_available, config),
                shortfall: formatNumber(shortfall.shortfall, config),
              })}
            </p>
            <ul className="mt-3 divide-y divide-border-subtle">
              {shortfall.suggested_rooms.flatMap((suggested) => {
                const room = rooms.find((r) => r.id === suggested.room_id);
                // Never a room id: a suggestion whose room is unknown is skipped.
                if (!room) return [];
                return [
                  <li key={suggested.room_id} className="flex items-center gap-3 py-2">
                    <span>
                      {roomLabel(room)} ·{' '}
                      {t('generate.roomCapacity', {
                        capacity: formatNumber(suggested.capacity, config),
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="ms-auto h-11 md:h-8"
                      onClick={() => toggleRoom(suggested.room_id, true)}
                      disabled={selectedRooms.has(suggested.room_id)}
                    >
                      {t('generate.addSuggestedRoom')}
                    </Button>
                  </li>,
                ];
              })}
            </ul>
          </div>
        )}

        {genericError !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {genericError}
          </p>
        )}
      </form>
    </FullPageShell>
  );
}
