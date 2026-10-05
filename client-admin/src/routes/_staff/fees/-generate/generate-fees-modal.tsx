/**
 * [16.3.6] Replaces `generate-fees-wizard.tsx`'s multi-step `WizardShell`
 * with a single full-page modal (`FullPageShell`, D21/D22/D23) and four
 * cards: Period → Students (`audience-picker.tsx`) → Fees (`fee-picker.tsx`)
 * → Check and create. D18 dropped the wizard entirely — there's no
 * dry-run-shaped review step here; instead `useGenerateFeesPreview` runs
 * on Generate and, only if it finds duplicates or inactive students,
 * shows `duplicates-step.tsx` inline in the same page before the real
 * `useGenerateFees` submit. The component is mounted only while `open`, so
 * every open starts from a fresh form.
 *
 * `useApprovedMutation(generate, { approvalScope: 'fees.duplicate_override'
 * })` — not `{ scope }` — per the published plan's correction
 * (`ui/src/hooks/approval.tsx:156-159` reserves `scope` for TanStack
 * Query's own mutation-concurrency option).
 */
import {
  ApiError,
  captureNotificationTenant,
  notifyOutcome,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  Card,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  Label,
  MonthPicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  feeStructuresQueryOptions,
  useAcademicYears,
  useGenerateFees,
  useGenerateFeesPreview,
  type AcademicYear,
  type DuplicateAction,
  type GenerateFeesPreviewResult,
  type PeriodType,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { AudiencePicker } from './audience-picker';
import { DuplicatesStep } from './duplicates-step';
import { FeePicker } from './fee-picker';

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Not `date.toISOString().slice(0, 10)`: `toISOString` converts to UTC
// first, and every `Date` this modal builds (`periodStart`,
// `addDays(periodStart, 9)`) is a *local* calendar date — "January 2026"
// means the browser's own January, not UTC's. Asia/Dhaka is UTC+6, so a
// user there picking "January" got `toISOString()`-truncated straight
// into "2025-12-31": local midnight Jan 1 is still Dec 31 in UTC. Found
// live by `e2e/journeys/generation.spec.ts` (16.3.6) — every Playwright
// run in this repo's own dev environment sits in that same +6 offset, so
// the bug reproduced there before it could reach a real user. Reading
// the date's own local Y/M/D fields sidesteps the UTC conversion
// entirely.
function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function describeSubmitError(error: unknown, t: TFunction<'feeGeneration'>): string {
  if (error instanceof RateLimitedError) return t('errors.rateLimited');
  // Only translated sentences reach the screen, never the server's own message.
  if (error instanceof ApiError && error.statusCode === 429) return t('errors.rateLimited');
  return t('errors.unknown');
}

function majorityClassId(studentNames: Map<string, string>): string | undefined {
  // The picker only tracks id -> name today (see `AudiencePicker`'s own
  // state), so there is no per-student class to tally here yet — this is
  // a deliberate scope cut: the fee list still renders in the server's
  // own order rather than crashing or floating a wrong guess to the top.
  // Left as a named seam (not inlined as `undefined` at the call site) so
  // a follow-up that threads `class_id` through the picker's selection
  // map only has to change this one function.
  void studentNames;
  return undefined;
}

export interface GenerateFeesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** [16.7.5]: the student-detail "Recurring fees" tab's "Bill one-off"
   * action opens this modal pre-selected to one student — a schedule's
   * audience genuinely doesn't match them (wrong academic year, wrong
   * class), so a one-off bill through this existing flow is the
   * fallback rather than a second bespoke billing UI. Seeded into
   * `selectedStudents` on open; the picker itself still lets staff add
   * or remove students from there. */
  preselectedStudent?: { id: string; name: string } | null;
}

export function GenerateFeesModal({
  open,
  onOpenChange,
  preselectedStudent,
}: GenerateFeesModalProps) {
  if (!open) return null;
  return (
    <GenerateFeesFullPage
      onClose={() => onOpenChange(false)}
      preselectedStudent={preselectedStudent ?? null}
    />
  );
}

function GenerateFeesFullPage({
  onClose,
  preselectedStudent,
}: {
  onClose: () => void;
  preselectedStudent: { id: string; name: string } | null;
}) {
  const { t } = useTranslation('feeGeneration');
  const regionConfig = useRegionConfig();

  const yearsQuery = useAcademicYears();
  const academicYears = React.useMemo(() => yearsQuery.data?.data ?? [], [yearsQuery.data]);

  const [academicYearId, setAcademicYearId] = React.useState('');
  const [periodType, setPeriodType] = React.useState<PeriodType>('MONTH');
  const [month, setMonth] = React.useState('');
  const [calendarYear, setCalendarYear] = React.useState('');
  const [weekStart, setWeekStart] = React.useState<Date | undefined>(undefined);
  const [dueDate, setDueDate] = React.useState<Date | undefined>(undefined);
  const [dueDateTouched, setDueDateTouched] = React.useState(false);
  const [notifyFamilies, setNotifyFamilies] = React.useState(true);
  // Set by the user's own year / month picks (not by the auto-defaults).
  const [periodTouched, setPeriodTouched] = React.useState(false);
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);

  const [selectedStudents, setSelectedStudents] = React.useState<Map<string, string>>(() =>
    preselectedStudent
      ? new Map([[preselectedStudent.id, preselectedStudent.name]])
      : new Map<string, string>(),
  );
  const [selectedFees, setSelectedFees] = React.useState<Set<string>>(new Set());
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);

  const [preview, setPreview] = React.useState<GenerateFeesPreviewResult | null>(null);
  const [previewScopeKey, setPreviewScopeKey] = React.useState<string | null>(null);
  const [duplicateAction, setDuplicateAction] = React.useState<DuplicateAction>('SKIP');

  React.useEffect(() => {
    if (academicYearId !== '' || academicYears.length === 0) return;
    const current = academicYears.find((year: AcademicYear) => year.is_current) ?? academicYears[0];
    if (current) setAcademicYearId(current.id);
  }, [academicYearId, academicYears]);

  const selectedYear = academicYears.find((year) => year.id === academicYearId);

  // Defaults the month/year picker to the chosen academic year's first
  // month — same reasoning the old wizard gave: "this month" would sit
  // outside the academic year for part of the calendar. Keyed on
  // `academicYearId`, not on `selectedYear` itself, for the same
  // background-refetch reason the wizard's own effect documents. Also
  // re-defaults when the chosen year changes and the current month falls
  // outside it, since `MonthPicker` disables every month outside the year.
  React.useEffect(() => {
    if (!selectedYear) return;
    const picked =
      month !== '' && calendarYear !== '' ? `${calendarYear}-${month.padStart(2, '0')}` : '';
    if (
      picked !== '' &&
      picked >= selectedYear.start_date.slice(0, 7) &&
      picked <= selectedYear.end_date.slice(0, 7)
    ) {
      return;
    }
    const start = parseServerDate(selectedYear.start_date);
    setMonth(String(start.getMonth() + 1));
    setCalendarYear(String(start.getFullYear()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only, not a controlled sync
  }, [academicYearId]);

  const periodStart = React.useMemo(() => {
    if (periodType === 'WEEK') {
      return weekStart;
    }
    if (month === '' || calendarYear === '') return undefined;
    return new Date(Number(calendarYear), Number(month) - 1, 1);
  }, [periodType, weekStart, month, calendarYear]);

  // Due date defaults to period start + 9 days, but only until the
  // accountant edits it directly — otherwise every period change would
  // silently overwrite a due date they'd deliberately chosen.
  React.useEffect(() => {
    if (dueDateTouched || !periodStart) return;
    setDueDate(addDays(periodStart, 9));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only, not a controlled sync
  }, [periodStart]);

  const generate = useGenerateFees();
  const previewMutation = useGenerateFeesPreview();

  // Same data `FeePicker` fetches for its own list — re-queried here (React
  // Query dedupes by key, so this doesn't double the network call) purely
  // to build an id -> name lookup for `DuplicatesStep`, since the preview
  // response only ever carries `fee_structure_id` (see
  // `ui/src/hooks/fee-generation.ts`'s own comment on `DuplicateBillDto`).
  const feeStructuresQuery = useQuery({
    ...feeStructuresQueryOptions({ academic_year_id: academicYearId, limit: 100 }),
    enabled: academicYearId !== '',
  });
  const feeStructureNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const structure of feeStructuresQuery.data?.data ?? []) {
      map.set(structure.id, structure.name);
    }
    return map;
  }, [feeStructuresQuery.data]);

  // Anything the user has touched — Close / Esc then ask before discarding.
  const dirty =
    selectedFees.size > 0 ||
    programId !== undefined ||
    dueDateTouched ||
    periodTouched ||
    periodType !== 'MONTH' ||
    weekStart !== undefined ||
    !notifyFamilies ||
    selectedStudents.size > (preselectedStudent ? 1 : 0);

  const feeCount = selectedFees.size;
  const studentCount = selectedStudents.size;
  // The server's own resolved count for the current scope, once a preview
  // has actually run against it (`students_total` covers program-only
  // scopes the client never enumerates itself) — stale once the scope
  // changes again, same guard `handleGenerateClick` already uses.
  const resolvedStudentCount =
    preview && previewScopeKey === scopeKey() ? preview.students_total : undefined;
  const effectiveStudentCount = resolvedStudentCount ?? studentCount;
  const canGenerate =
    academicYearId !== '' &&
    periodStart !== undefined &&
    dueDate !== undefined &&
    // [34.5.3] `program_id` alone resolves the whole program server-side
    // (`GenerateFeesDto.program_id`, additive with `student_ids` when both
    // are set) — a staffer targeting "active students of program X" never
    // has to tick individual checkboxes.
    (studentCount > 0 || programId !== undefined) &&
    feeCount > 0 &&
    !previewMutation.isPending &&
    !generate.isPending;

  /** Exactly `GenerateFeesPreviewDto` (the preview endpoint's own DTO),
   * which has no `due_date` field at all — `GenerateFeesDto` (the real
   * generate call) is the one that extends it with `due_date`/
   * `duplicate_action`/`notify_families`. The server's `ValidationPipe`
   * rejects unknown properties outright, so sending the generate-shaped
   * payload — which carries `due_date` for the generate call's sake —
   * straight to the preview endpoint 400s every preview. Built as the
   * narrower shape here and widened by `scope()` below, mirroring the
   * `extends` relationship between the two DTOs.
   *
   * Both DTOs take `period_start` (an ISO date) and `period_type` — never
   * `month`/`year`/`week_start` directly. Those were being sent as their
   * own top-level fields, which the server's `class-validator` DTO
   * rejects outright ("property month should not exist … period_start
   * must be a valid ISO 8601 date string"), so every preview 400'd and
   * the whole modal crashed rendering the error. `periodStart` above is
   * already the correctly-derived `Date` for both period types — this
   * just needed to serialize it. */
  function previewScope() {
    // `student_ids` is only sent when the selection is genuinely nonempty —
    // an empty array still resolves as "these specific zero students" on
    // the server, not "no student filter", so a program-only request must
    // omit the key entirely rather than send `student_ids: []`.
    const studentIds = Array.from(selectedStudents.keys());
    return {
      academic_year_id: academicYearId,
      period_type: periodType,
      period_start: periodStart ? toDateInputValue(periodStart) : '',
      ...(studentIds.length > 0 ? { student_ids: studentIds } : {}),
      ...(programId ? { program_id: programId } : {}),
      fee_structure_ids: Array.from(selectedFees),
    };
  }

  /** `GenerateFeesDto`'s own shape: the preview scope plus `due_date`. */
  function scope() {
    return { ...previewScope(), due_date: dueDate ? toDateInputValue(dueDate) : '' };
  }

  // Sorted so the key doesn't depend on Set/Map iteration order, and used
  // to detect a scope change between a preview and the Generate click that
  // follows it — without this, editing students/fees *after* a duplicates
  // preview came back would silently submit the stale preview's
  // `duplicateAction` against the new, unpreviewed scope.
  function scopeKey() {
    const raw = scope();
    return JSON.stringify({
      ...raw,
      student_ids: [...(raw.student_ids ?? [])].sort(),
      fee_structure_ids: [...raw.fee_structure_ids].sort(),
    });
  }

  function submitGenerate(action?: DuplicateAction) {
    const notifyTenantId = captureNotificationTenant();
    generate.mutate(
      {
        ...scope(),
        notify_families: notifyFamilies,
        ...(action ? { duplicate_strategy: action } : {}),
      },
      {
        onSuccess: (result) => {
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'success',
            message: t('notifications.generated', {
              generated: formatNumber(result.generated_count, regionConfig),
              skipped: formatNumber(result.skipped_count, regionConfig),
              students: formatNumber(result.student_count, regionConfig),
            }),
          });
          onClose();
        },
        onError: () =>
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'error',
            message: t('notifications.failed'),
          }),
      },
    );
  }

  function handleGenerateClick(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (!canGenerate) return;

    const currentScopeKey = scopeKey();
    if (preview && previewScopeKey === currentScopeKey) {
      submitGenerate(duplicateAction);
      return;
    }

    previewMutation.mutate(previewScope(), {
      onSuccess: (result) => {
        if (result.duplicates.length === 0 && result.inactive.length === 0) {
          submitGenerate();
          return;
        }
        setPreview(result);
        setPreviewScopeKey(currentScopeKey);
      },
    });
  }

  const submitError = generate.error ?? previewMutation.error;

  const bills =
    duplicateAction === 'SKIP' && preview !== null && previewScopeKey === scopeKey()
      ? preview.would_generate
      : effectiveStudentCount * feeCount;
  const monthMin = selectedYear?.start_date.slice(0, 7);
  const monthMax = selectedYear?.end_date.slice(0, 7);
  const requiredMark = (
    <>
      <span className="text-destructive" aria-hidden="true">
        {' '}
        *
      </span>
      <span className="sr-only"> {t('form.required', { ns: 'common' })}</span>
    </>
  );

  return (
    <FullPageShell
      title={t('title')}
      onClose={onClose}
      dirty={dirty}
      size="form"
      primary={{
        label: t('review.submitAction'),
        onClick: () => handleGenerateClick(),
        busy: previewMutation.isPending || generate.isPending,
        disabled: !canGenerate,
      }}
      // Cancel asks first when something changed, same as Close / Esc.
      secondary={{
        label: t('modal.cancel'),
        onClick: () => (dirty ? setConfirmingCancel(true) : onClose()),
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Cmd/Ctrl+Enter submit shortcut */}
      <form
        className="space-y-6"
        onSubmit={handleGenerateClick}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter submits from anywhere in the form — Enter alone
          // inside the audience search box is separately swallowed in
          // `AudiencePicker` so it never bubbles here as a plain Enter.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            handleGenerateClick(event);
          }
        }}
      >
        <Card padded>
          <h2 className="text-h2">{t('section.periodTitle')}</h2>
          <p className="mt-0.5 text-text-secondary">{t('section.periodDescription')}</p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="generate-year">
                {t('year.label')}
                {requiredMark}
              </Label>
              <Select
                value={academicYearId}
                onValueChange={(value) => {
                  setAcademicYearId(value);
                  setPeriodTouched(true);
                }}
              >
                <SelectTrigger id="generate-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {academicYears.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="generate-period-type">{t('period.typeLabel')}</Label>
              <Select
                value={periodType}
                onValueChange={(value) => setPeriodType(value as PeriodType)}
              >
                <SelectTrigger id="generate-period-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTH">{t('period.month')}</SelectItem>
                  <SelectItem value="WEEK">{t('period.week')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodType === 'MONTH' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="generate-month">
                  {t('period.monthLabel')}
                  {requiredMark}
                </Label>
                <MonthPicker
                  id="generate-month"
                  aria-label={t('period.monthLabel')}
                  value={
                    month !== '' && calendarYear !== ''
                      ? `${calendarYear}-${month.padStart(2, '0')}`
                      : undefined
                  }
                  onValueChange={(value) => {
                    const [year = '', picked = ''] = value.split('-');
                    setPeriodTouched(true);
                    setCalendarYear(year);
                    setMonth(String(Number(picked)));
                  }}
                  min={monthMin}
                  max={monthMax}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="generate-week-start">
                  {t('period.weekStartLabel')}
                  {requiredMark}
                </Label>
                <DatePicker
                  id="generate-week-start"
                  aria-label={t('period.weekStartLabel')}
                  config={regionConfig}
                  value={weekStart}
                  onValueChange={setWeekStart}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="generate-due-date">
                {t('period.dueDateLabel')}
                {requiredMark}
              </Label>
              <DatePicker
                id="generate-due-date"
                aria-label={t('period.dueDateLabel')}
                config={regionConfig}
                value={dueDate}
                onValueChange={(date) => {
                  setDueDate(date);
                  setDueDateTouched(true);
                }}
              />
              <p className="text-caption text-text-secondary">{t('period.dueDateHelp')}</p>
            </div>
          </div>
        </Card>

        <AudiencePicker
          academicYearId={academicYearId}
          selected={selectedStudents}
          onSelectedChange={setSelectedStudents}
          programId={programId}
          onProgramIdChange={setProgramId}
        />

        <FeePicker
          academicYearId={academicYearId}
          academicYearName={selectedYear?.name ?? ''}
          majorityClassId={majorityClassId(selectedStudents)}
          selected={selectedFees}
          onSelectedChange={setSelectedFees}
        />

        <Card padded>
          <h2 className="text-h2">{t('review.title')}</h2>
          {studentCount === 0 && programId !== undefined && resolvedStudentCount === undefined ? (
            <p className="mt-2 text-text-secondary">{t('summary.programAudience')}</p>
          ) : (
            <>
              <p className="mt-2 text-h3">
                {t('summary.bills', { count: bills, n: formatNumber(bills, regionConfig) })}
              </p>
              <p className="text-text-secondary">
                {t('summary.detail', {
                  students: formatNumber(effectiveStudentCount, regionConfig),
                  fees: formatNumber(feeCount, regionConfig),
                })}
              </p>
            </>
          )}

          {preview && (
            <DuplicatesStep
              preview={preview}
              action={duplicateAction}
              onActionChange={setDuplicateAction}
              studentNames={selectedStudents}
              feeStructureNames={feeStructureNames}
            />
          )}

          <div className="mt-3 border-t border-border-subtle pt-3">
            <label className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                checked={notifyFamilies}
                onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              />
              {t('notify.label')}
            </label>
          </div>

          {submitError !== null && submitError !== undefined && (
            <p role="alert" className="mt-3 flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-3.5" aria-hidden="true" />
              {describeSubmitError(submitError, t)}
            </p>
          )}
        </Card>
      </form>
      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        tone="danger"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setConfirmingCancel(false);
          onClose();
        }}
      />
    </FullPageShell>
  );
}
