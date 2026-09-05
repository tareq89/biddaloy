/**
 * [9.6] The marking screen. `?date=`/`?period=` are the single source of
 * truth for "which day am I marking" — draft state is keyed off them, not
 * held independently, so a date change never leaves two disagreeing
 * answers to that question in play at once.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@biddaloy/ui/components';
import {
  sectionRegisterQueryOptions,
  useActiveTenant,
  useHasPermission,
  useOnline,
  useSectionRegister,
  useSubmitRegister,
  type PutRegisterInput,
  type Register,
  type RegisterStudent,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { History, MoreVertical } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ConflictDialog } from './-conflict-dialog';
import { CorrectionDialog } from './-correction-dialog';
import { RecordHistoryPanel } from './-record-history-panel';
import { RosterMarker, type Draft } from './-roster-marker';

// `.toISOString()` is UTC — see `index.tsx`'s identical fix. This
// function is what decides the search-schema default AND the future-date
// gate (`date > todayIso()`), so a UTC skew here doesn't just link to the
// wrong day, it can wrongly deny or allow the LEAVE-only future-date path.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => todayIso()),
  period: z.coerce.number().int().min(1).max(12).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/attendance/$sectionId')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ date: search.date, period: search.period }),
  loader: ({ context: { queryClient }, params, deps }) =>
    Promise.all([
      queryClient
        .ensureQueryData(sectionRegisterQueryOptions(params.sectionId, deps.date, deps.period))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('attendance'),
    ]),
  component: SectionRegisterPage,
});

function draftKey(tenantId: string | null, sectionId: string, date: string): string {
  return `attendance-draft:${tenantId ?? 'no-tenant'}:${sectionId}:${date}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Best-effort — a lost draft-persistence write is recoverable (the
    // in-memory draft still submits), unlike a lost server write.
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See `writeDraft`.
  }
}

function seedDraft(register: Register): Draft {
  const draft: Draft = {};
  for (const student of register.students) {
    draft[student.student_id] = {
      // `schema.d.ts`'s generated `RegisterStudentDto.status` is the bare
      // string-literal union (`openapi-typescript` doesn't reference
      // `@biddaloy/shared`'s enum), not `AttendanceStatus` itself —
      // structurally identical, so the cast is safe.
      status: student.status as AttendanceStatus | null,
      minutes_late: student.minutes_late,
    };
  }
  return draft;
}

function SectionRegisterPage() {
  const { t } = useTranslation('attendance');
  const { sectionId } = Route.useParams();
  const { date, period } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tenantId = useActiveTenant();
  const online = useOnline();
  const canMark = useHasPermission(Permission.ATTENDANCE_MARK);
  // [9.7] `register.editable === false` already implies the caller lacks
  // ATTENDANCE_CORRECT server-side — `attendance.service.ts`'s own
  // `editable` formula ORs every one of its window/finalized/non-working
  // checks with `hasCorrect`, so a caller who *does* hold it always gets
  // `editable: true` and edits inline via the normal marking flow. This
  // flag only ever matters for a future role/permission mapping that
  // grants ATTENDANCE_CORRECT without full marking rights.
  const canCorrect = useHasPermission(Permission.ATTENDANCE_CORRECT);
  const regionConfig = useTenantRegionConfig();

  const registerQuery = useSectionRegister(sectionId, date, period);
  const submitRegister = useSubmitRegister(sectionId);

  const [correctionStudentId, setCorrectionStudentId] = React.useState<string | null>(null);
  const [historyStudentId, setHistoryStudentId] = React.useState<string | null>(null);

  const storageKey = draftKey(tenantId, sectionId, date);
  const [draft, setDraft] = React.useState<Draft>({});
  const [confirmUnmarkedOpen, setConfirmUnmarkedOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState<{
    currentRegister: Register | undefined;
    currentVersion: number | undefined;
  } | null>(null);

  // Seeds from a saved local draft first (survives a reload while
  // offline), falling back to the server's register — see the plan's
  // "Draft state" section.
  React.useEffect(() => {
    if (!registerQuery.data) return;
    const saved = readDraft(storageKey);
    setDraft(saved ?? seedDraft(registerQuery.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only on section/date/period change, not every draft edit
  }, [sectionId, date, period, registerQuery.data]);

  React.useEffect(() => {
    if (registerQuery.data) writeDraft(storageKey, draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist on every draft change, key derived above
  }, [draft, storageKey]);

  function handleUndo(previous: Draft) {
    setDraft(previous);
  }

  function handleStatusChange(studentId: string, status: AttendanceStatus) {
    setDraft((current) => ({
      ...current,
      [studentId]: { status, minutes_late: current[studentId]?.minutes_late ?? null },
    }));
  }

  function handleMinutesLateChange(studentId: string, minutes: number | null) {
    setDraft((current) => ({
      ...current,
      [studentId]: { status: current[studentId]?.status ?? null, minutes_late: minutes },
    }));
  }

  function handleAllPresent() {
    // Mirrors `RosterMarker`'s own `isStatusAllowed` guard — a future date
    // under `policy.allow_future_dates` restricts every row to LEAVE, and
    // this bulk action (reachable from the toolbar button, `Shift+P`, and
    // the unmarked-students confirm dialog) must not fill them with a
    // status the policy forbids.
    if (allowedStatuses && !allowedStatuses.includes(AttendanceStatus.PRESENT)) return;
    const previous = draft;
    setDraft((current) => {
      const next: Draft = { ...current };
      for (const student of registerQuery.data?.students ?? []) {
        if (!next[student.student_id]?.status) {
          next[student.student_id] = { status: AttendanceStatus.PRESENT, minutes_late: null };
        }
      }
      return next;
    });
    toast.success(t('mark.allPresent'), {
      action: { label: t('mark.undo'), onClick: () => handleUndo(previous) },
      duration: 5000,
    });
  }

  function handleReset() {
    const previous = draft;
    setDraft({});
    toast.success(t('mark.undoToast'), {
      action: { label: t('mark.undo'), onClick: () => handleUndo(previous) },
      duration: 5000,
    });
  }

  const students = registerQuery.data?.students ?? [];
  const counts = students.reduce(
    (acc, student) => {
      const status = draft[student.student_id]?.status ?? null;
      if (status === AttendanceStatus.PRESENT) acc.present += 1;
      else if (status === AttendanceStatus.ABSENT) acc.absent += 1;
      else if (status === AttendanceStatus.LATE) acc.late += 1;
      else if (status === AttendanceStatus.LEAVE) acc.leave += 1;
      else acc.unmarked += 1;
      return acc;
    },
    { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 },
  );

  function buildInput(): PutRegisterInput {
    return {
      date,
      ...(period !== undefined ? { period_no: period } : {}),
      base_version: registerQuery.data?.session.version ?? 0,
      client_request_id: crypto.randomUUID(),
      entries: Object.entries(draft)
        .filter(([, entry]) => entry.status !== null)
        .map(([student_id, entry]) => ({
          student_id,
          status: entry.status as AttendanceStatus,
          ...(entry.status === AttendanceStatus.LATE && entry.minutes_late !== null
            ? { minutes_late: entry.minutes_late }
            : {}),
        })),
    };
  }

  function doSubmit() {
    submitRegister.mutate(buildInput(), {
      onSuccess: (result) => {
        if (result.queued) {
          toast.success(t('mark.queuedToast'));
        } else {
          toast.success(t('mark.savedToast'));
        }
        clearDraft(storageKey);
        void navigate({ to: '/attendance' });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.statusCode === 409) {
          const details = error.details as
            { current_version?: number; register?: Register } | undefined;
          setConflict({
            currentRegister: details?.register,
            currentVersion: details?.current_version,
          });
          return;
        }
        toast.error(error instanceof Error ? error.message : t('mark.errorToast'));
      },
    });
  }

  function handleSubmit() {
    if (counts.unmarked > 0) {
      setConfirmUnmarkedOpen(true);
      return;
    }
    doSubmit();
  }

  function handleKeepMine(currentVersion: number) {
    submitRegister.mutate(
      { ...buildInput(), base_version: currentVersion, client_request_id: crypto.randomUUID() },
      {
        onSuccess: (result) => {
          toast.success(result.queued ? t('mark.queuedToast') : t('mark.savedToast'));
          clearDraft(storageKey);
          setConflict(null);
          void navigate({ to: '/attendance' });
        },
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) {
            const details = error.details as
              { current_version?: number; register?: Register } | undefined;
            setConflict({
              currentRegister: details?.register,
              currentVersion: details?.current_version,
            });
            return;
          }
          toast.error(error instanceof Error ? error.message : t('mark.errorToast'));
        },
      },
    );
  }

  function handleTakeTheirs() {
    setConflict(null);
    // Clear the persisted draft *before* refetching — the seed effect
    // above reads localStorage before the server response, so a stale
    // write still sitting there would win over the fresh register once
    // this refetch resolves and that effect re-runs.
    clearDraft(storageKey);
    void registerQuery.refetch().then((result) => {
      if (result.data) setDraft(seedDraft(result.data));
    });
  }

  if (registerQuery.isPending) return null;
  if (registerQuery.isError) {
    return <p className="p-4 text-sm text-destructive">{t('mark.errorToast')}</p>;
  }

  const register = registerQuery.data;
  const editable = register.editable && canMark;
  // [9.7] Whether the correction dialog (PATCH, reason-captured) is on
  // offer for this register, as distinct from `editable` (the normal
  // inline PUT flow). See `canCorrect`'s own comment above for why this
  // can only ever be true for a caller who holds ATTENDANCE_CORRECT but
  // whose `register.editable` still came back `false`.
  const canCorrectOutsideWindow = !register.editable && canCorrect;
  const futureDateLeaveOnly = date > todayIso() && register.policy.allow_future_dates;
  const allowedStatuses = futureDateLeaveOnly ? [AttendanceStatus.LEAVE] : undefined;
  const correctionStudent = students.find((s) => s.student_id === correctionStudentId) ?? null;
  const historyStudent = students.find((s) => s.student_id === historyStudentId) ?? null;

  // [9.7] Trailing per-row slot: an "Edited" badge for a corrected mark,
  // plus a Correct/History overflow menu once the register is outside
  // its editable window. Renders nothing while `register.editable` is
  // true — the normal inline marking flow already covers that case.
  function renderRowActions(student: RegisterStudent) {
    if (register.editable) return null;
    if (!student.record_id) return null; // never marked — nothing to correct or view

    return (
      <div className="flex items-center gap-1">
        {student.correction_count > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <History aria-hidden="true" className="size-3" />
                  {t('mark.editedBadge')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('mark.editedBadgeTooltip', { count: student.correction_count })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Menu>
          <MenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              iconOnly
              aria-label={t('mark.rowMenuLabel', { name: student.full_name })}
            >
              <MoreVertical aria-hidden="true" />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {canCorrectOutsideWindow && (
              <MenuItem onSelect={() => setCorrectionStudentId(student.student_id)}>
                {t('mark.correctAction')}
              </MenuItem>
            )}
            <MenuItem onSelect={() => setHistoryStudentId(student.student_id)}>
              {t('mark.historyAction')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-24">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border-subtle bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">
            {t('mark.title', {
              className: register.section.class_name,
              sectionName: register.section.section_name,
            })}
          </h1>
          <DatePicker
            aria-label={t('list.title')}
            config={regionConfig}
            value={parseDate(date)}
            onValueChange={(next) =>
              void navigate({
                search: (prev) => ({ ...prev, date: next ? formatDate(next, regionConfig) : date }),
              })
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('mark.presentCount', { n: counts.present })} ·{' '}
          {t('mark.absentCount', { n: counts.absent })} · {t('mark.lateCount', { n: counts.late })}{' '}
          · {t('mark.unmarkedCount', { n: counts.unmarked })}
        </p>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAllPresent}
              disabled={Boolean(
                allowedStatuses && !allowedStatuses.includes(AttendanceStatus.PRESENT),
              )}
            >
              {t('mark.allPresent')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
              {t('mark.reset')}
            </Button>
            <span className="hidden text-xs text-muted-foreground md:inline">
              {t('mark.shortcutHint')}
            </span>
          </div>
        )}
        {!register.editable && (
          <p className="rounded-md border border-border-subtle bg-muted p-2 text-sm text-muted-foreground">
            {canCorrectOutsideWindow
              ? t('mark.readOnlyExplanation')
              : t('mark.readOnlyNoPermission', {
                  days: register.policy.correction_window_days,
                })}
          </p>
        )}
        {futureDateLeaveOnly && (
          <p className="rounded-md border border-border-subtle bg-muted p-2 text-sm text-muted-foreground">
            {t('mark.futureDateBanner')}
          </p>
        )}
      </div>

      <div className="px-4">
        <RosterMarker
          students={students}
          draft={draft}
          onStatusChange={handleStatusChange}
          onMinutesLateChange={handleMinutesLateChange}
          onAllPresent={handleAllPresent}
          onSubmit={handleSubmit}
          disabled={!editable}
          allowedStatuses={allowedStatuses}
          renderRowActions={renderRowActions}
        />
      </div>

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border-subtle bg-background p-4">
          <span className="text-sm text-muted-foreground">
            {t('mark.unmarkedRemaining', { n: counts.unmarked })}
          </span>
          <Button
            type="button"
            className="min-h-12 flex-1"
            loading={submitRegister.isPending}
            onClick={handleSubmit}
          >
            {submitRegister.isPending
              ? t('mark.submitting')
              : online
                ? t('mark.submitOnline')
                : t('mark.submitOffline')}
          </Button>
        </div>
      )}

      <Dialog open={confirmUnmarkedOpen} onOpenChange={setConfirmUnmarkedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('mark.confirmUnmarkedTitle', { n: counts.unmarked })}</DialogTitle>
            <DialogDescription>{t('mark.confirmUnmarkedBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmUnmarkedOpen(false)}>
              {t('mark.confirmUnmarkedCancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmUnmarkedOpen(false);
                handleAllPresent();
              }}
            >
              {t('mark.confirmUnmarkedMarkRestPresent')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmUnmarkedOpen(false);
                doSubmit();
              }}
            >
              {t('mark.confirmUnmarkedSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictDialog
        open={conflict !== null}
        onOpenChange={(open) => !open && setConflict(null)}
        currentRegister={conflict?.currentRegister}
        currentVersion={conflict?.currentVersion}
        draft={draft}
        students={students}
        onKeepMine={handleKeepMine}
        onTakeTheirs={handleTakeTheirs}
      />

      {correctionStudent && (
        <CorrectionDialog
          open={correctionStudentId !== null}
          onOpenChange={(open) => !open && setCorrectionStudentId(null)}
          sectionId={sectionId}
          date={date}
          periodNo={period}
          student={correctionStudent}
        />
      )}

      <Dialog
        open={historyStudentId !== null}
        onOpenChange={(open) => !open && setHistoryStudentId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {historyStudent
                ? t('history.title', { name: historyStudent.full_name })
                : t('mark.historyAction')}
            </DialogTitle>
          </DialogHeader>
          {historyStudent && (
            <RecordHistoryPanel
              recordId={historyStudent.record_id ?? undefined}
              studentName={historyStudent.full_name}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
