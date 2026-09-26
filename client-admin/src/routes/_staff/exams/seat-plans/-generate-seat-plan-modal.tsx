/**
 * [25.6] "Generate seat plan" modal: pick an exam (to scope which subject
 * sittings are on offer, since there's no cross-exam schedule listing
 * endpoint — `GET /exams/:examId/schedule` is per-exam, see `ui/src/hooks
 * /exams.ts`'s `useExamSchedule`), multi-select the sittings and rooms,
 * pick a seat-order mode, and submit to `POST /seat-plans/generate`.
 *
 * Two feedback paths the ticket calls out (D4/D5):
 * - 400 `SEAT_CAPACITY_SHORTFALL` (`details.code`, see `ui/src/hooks
 *   /seat-plans.ts`): shown inline with the shortfall and suggested rooms,
 *   each with an "Add" button that checks it into the room list so retry
 *   is a single click, no need to leave the modal.
 * - A successful generate can still carry non-empty `conflicts` (room/time
 *   overlaps with another PUBLISHED plan, D5) — the plan is already
 *   created at that point (the server only *warns*, per `checkRoomConflicts`
 *   `seat-plans.service.ts`), so this modal shows them as an
 *   acknowledgement notice on the way to closing, not a blocking error.
 */
import { ApiError, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useExamSchedule,
  useExams,
  useGenerateSeatPlan,
  useRooms,
  type GenerateSeatPlanResult,
  type SeatCapacityShortfallDetails,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface GenerateSeatPlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** `Room` has no `name` field (`room_no` + optional `building`) — this is
 * the one display label used everywhere in this modal so a room's line
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

export function GenerateSeatPlanModal({ open, onOpenChange }: GenerateSeatPlanModalProps) {
  const { t } = useTranslation('seatPlans');

  const [name, setName] = React.useState('');
  const [examId, setExamId] = React.useState('');
  const [selectedSchedules, setSelectedSchedules] = React.useState<Set<string>>(new Set());
  const [selectedRooms, setSelectedRooms] = React.useState<Set<string>>(new Set());
  const [seatOrderMode, setSeatOrderMode] = React.useState<'SEQUENTIAL' | 'RANDOM'>('SEQUENTIAL');
  const [result, setResult] = React.useState<GenerateSeatPlanResult | null>(null);

  const examsQuery = useExams({ limit: 100 });
  const exams = examsQuery.data?.data ?? [];
  const scheduleQuery = useExamSchedule(examId || undefined);
  const schedules = scheduleQuery.data ?? [];
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data?.data ?? [];

  const generate = useGenerateSeatPlan();

  function reset() {
    setName('');
    setExamId('');
    setSelectedSchedules(new Set());
    setSelectedRooms(new Set());
    setSeatOrderMode('SEQUENTIAL');
    setResult(null);
    generate.reset();
  }

  function close() {
    reset();
    onOpenChange(false);
  }

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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
          setResult(data);
          if (data.conflicts.length === 0) {
            notifyOutcome({
              tenantId: notifyTenantId,
              variant: 'success',
              message: t('generate.success'),
            });
            close();
          }
        },
      },
    );
  }

  const shortfall =
    generate.error instanceof ApiError && isShortfallDetails(generate.error.details)
      ? generate.error.details
      : undefined;
  const genericError =
    generate.error && !shortfall
      ? generate.error instanceof ApiError
        ? generate.error.message
        : t('errors.unknown')
      : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('generate.title')}</DialogTitle>
          <DialogDescription>{t('generate.description')}</DialogDescription>
        </DialogHeader>

        {result && result.conflicts.length > 0 ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-amber-700">
              {t('generate.conflictsNotice', { count: result.conflicts.length })}
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-2 text-sm">
              {result.conflicts.map((conflict, index) => (
                <li key={index}>
                  {t('generate.conflictLine', {
                    roomId: conflict.room_id,
                    planId: conflict.conflicting_seat_plan_id,
                  })}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={close}>
                {t('generate.acknowledge')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('generate.nameLabel')}</span>
              <Input
                aria-label={t('generate.nameLabel')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('generate.examLabel')}</span>
              <Select
                value={examId}
                onValueChange={(value) => {
                  setExamId(value);
                  setSelectedSchedules(new Set());
                }}
              >
                <SelectTrigger aria-label={t('generate.examLabel')}>
                  <SelectValue placeholder={t('generate.examPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2" data-testid="schedule-picker">
              <span className="text-sm font-medium">{t('generate.schedulesLabel')}</span>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-2">
                {examId === '' && (
                  <li className="text-sm text-muted-foreground">
                    {t('generate.schedulesPickExamFirst')}
                  </li>
                )}
                {examId !== '' && scheduleQuery.isPending && (
                  <li className="text-sm text-muted-foreground">{t('generate.loading')}</li>
                )}
                {examId !== '' && scheduleQuery.isSuccess && schedules.length === 0 && (
                  <li className="text-sm text-muted-foreground">{t('generate.schedulesEmpty')}</li>
                )}
                {schedules.map((schedule) => (
                  <li key={schedule.id} className="flex items-center gap-2 px-1 py-1">
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedSchedules.has(schedule.id)}
                        onCheckedChange={(checked) => toggleSchedule(schedule.id, checked === true)}
                        aria-label={schedule.subject?.name_en ?? schedule.id}
                      />
                      {schedule.subject?.name_en ?? schedule.id} — {schedule.date}{' '}
                      {schedule.starts_at}–{schedule.ends_at}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2" data-testid="room-picker">
              <span className="text-sm font-medium">{t('generate.roomsLabel')}</span>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle p-2">
                {roomsQuery.isPending && (
                  <li className="text-sm text-muted-foreground">{t('generate.loading')}</li>
                )}
                {roomsQuery.isSuccess && rooms.length === 0 && (
                  <li className="text-sm text-muted-foreground">{t('generate.roomsEmpty')}</li>
                )}
                {rooms.map((room) => (
                  <li key={room.id} className="flex items-center justify-between gap-2 px-1 py-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedRooms.has(room.id)}
                        onCheckedChange={(checked) => toggleRoom(room.id, checked === true)}
                        aria-label={roomLabel(room)}
                      />
                      {roomLabel(room)}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {t('generate.roomCapacity', { capacity: room.capacity ?? 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('generate.seatOrderLabel')}</span>
              <Select
                value={seatOrderMode}
                onValueChange={(value) => setSeatOrderMode(value as 'SEQUENTIAL' | 'RANDOM')}
              >
                <SelectTrigger aria-label={t('generate.seatOrderLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEQUENTIAL">{t('generate.seatOrderSequential')}</SelectItem>
                  <SelectItem value="RANDOM">{t('generate.seatOrderRandom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {shortfall && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-destructive p-3 text-sm"
              >
                <p>
                  {t('generate.shortfallMessage', {
                    needed: shortfall.seats_needed,
                    available: shortfall.seats_available,
                    shortfall: shortfall.shortfall,
                  })}
                </p>
                {shortfall.suggested_rooms.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {shortfall.suggested_rooms.map((suggested) => {
                      const room = rooms.find((r) => r.id === suggested.room_id);
                      return (
                        <li
                          key={suggested.room_id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            {room ? roomLabel(room) : suggested.room_id} —{' '}
                            {t('generate.roomCapacity', { capacity: suggested.capacity })}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRoom(suggested.room_id, true)}
                            disabled={selectedRooms.has(suggested.room_id)}
                          >
                            {t('generate.addSuggestedRoom')}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {genericError !== undefined && (
              <p role="alert" className="text-sm text-destructive">
                {genericError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {t('generate.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit} loading={generate.isPending}>
                {t('generate.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
