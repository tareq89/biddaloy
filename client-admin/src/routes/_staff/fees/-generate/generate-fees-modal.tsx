/**
 * [16.3.6] Replaces `generate-fees-wizard.tsx`'s multi-step `WizardShell`
 * with a single `Dialog` + one react-hook-form form: Period → Students
 * (`audience-picker.tsx`) → Fees (`fee-picker.tsx`) → Notify families →
 * footer preview + Generate. D18 dropped the wizard entirely — there's no
 * dry-run-shaped review step here; instead `useGenerateFeesPreview` runs
 * on Generate and, only if it finds duplicates or inactive students,
 * shows `duplicates-step.tsx` inline in the same dialog before the real
 * `useGenerateFees` submit.
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
  useAcademicYears,
  useGenerateFees,
  useGenerateFeesPreview,
  type AcademicYear,
  type DuplicateAction,
  type GenerateFeesPreviewResult,
  type PeriodType,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import * as React from 'react';

import { AudiencePicker } from './audience-picker';
import { DuplicatesStep } from './duplicates-step';
import { FeePicker } from './fee-picker';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function describeSubmitError(error: unknown, t: TFunction<'feeGeneration'>): string {
  if (error instanceof RateLimitedError) return t('errors.rateLimited');
  if (error instanceof ApiError) {
    return error.statusCode === 429 ? t('errors.rateLimited') : error.message;
  }
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
  const { t } = useTranslation('feeGeneration');

  const yearsQuery = useAcademicYears();
  const academicYears = React.useMemo(() => yearsQuery.data?.data ?? [], [yearsQuery.data]);

  const [academicYearId, setAcademicYearId] = React.useState('');
  const [periodType, setPeriodType] = React.useState<PeriodType>('MONTH');
  const [month, setMonth] = React.useState('');
  const [calendarYear, setCalendarYear] = React.useState('');
  const [weekStart, setWeekStart] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [dueDateTouched, setDueDateTouched] = React.useState(false);
  const [notifyFamilies, setNotifyFamilies] = React.useState(true);

  const [selectedStudents, setSelectedStudents] = React.useState<Map<string, string>>(new Map());
  const [selectedFees, setSelectedFees] = React.useState<Set<string>>(new Set());

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
  // background-refetch reason the wizard's own effect documents.
  React.useEffect(() => {
    if (!selectedYear || month !== '') return;
    const start = parseServerDate(selectedYear.start_date);
    setMonth(String(start.getMonth() + 1));
    setCalendarYear(String(start.getFullYear()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only, not a controlled sync
  }, [academicYearId]);

  const periodStart = React.useMemo(() => {
    if (periodType === 'WEEK') {
      return weekStart !== '' ? parseServerDate(weekStart) : undefined;
    }
    if (month === '' || calendarYear === '') return undefined;
    return new Date(Number(calendarYear), Number(month) - 1, 1);
  }, [periodType, weekStart, month, calendarYear]);

  // Due date defaults to period start + 9 days, but only until the
  // accountant edits it directly — otherwise every period change would
  // silently overwrite a due date they'd deliberately chosen.
  React.useEffect(() => {
    if (dueDateTouched || !periodStart) return;
    setDueDate(toDateInputValue(addDays(periodStart, 9)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only, not a controlled sync
  }, [periodStart]);

  React.useEffect(() => {
    if (!open || !preselectedStudent) return;
    setSelectedStudents(new Map([[preselectedStudent.id, preselectedStudent.name]]));
  }, [open, preselectedStudent]);

  const generate = useGenerateFees();
  const previewMutation = useGenerateFeesPreview();

  const feeCount = selectedFees.size;
  const studentCount = selectedStudents.size;
  const canGenerate =
    academicYearId !== '' &&
    periodStart !== undefined &&
    dueDate !== '' &&
    studentCount > 0 &&
    feeCount > 0 &&
    !previewMutation.isPending &&
    !generate.isPending;

  function scope() {
    return {
      academic_year_id: academicYearId,
      period_type: periodType,
      ...(periodType === 'MONTH' ? { month: Number(month), year: Number(calendarYear) } : {}),
      ...(periodType === 'WEEK' ? { week_start: weekStart } : {}),
      due_date: dueDate,
      student_ids: Array.from(selectedStudents.keys()),
      fee_structure_ids: Array.from(selectedFees),
    };
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
      student_ids: [...raw.student_ids].sort(),
      fee_structure_ids: [...raw.fee_structure_ids].sort(),
    });
  }

  function resetAndClose() {
    setPreview(null);
    setPreviewScopeKey(null);
    setDuplicateAction('SKIP');
    onOpenChange(false);
  }

  function submitGenerate(action?: DuplicateAction) {
    const notifyTenantId = captureNotificationTenant();
    generate.mutate(
      {
        ...scope(),
        notify_families: notifyFamilies,
        ...(action ? { duplicate_action: action } : {}),
      },
      {
        onSuccess: (result) => {
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'success',
            message: t('notifications.generated', {
              generated: result.generated,
              skipped: result.skipped,
              students: result.students_evaluated,
            }),
          });
          resetAndClose();
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

  function handleGenerateClick(event: React.FormEvent) {
    event.preventDefault();
    if (!canGenerate) return;

    const currentScopeKey = scopeKey();
    if (preview && previewScopeKey === currentScopeKey) {
      submitGenerate(duplicateAction);
      return;
    }

    previewMutation.mutate(scope(), {
      onSuccess: (result) => {
        if (result.duplicates.length === 0 && result.inactive_students.length === 0) {
          submitGenerate();
          return;
        }
        setPreview(result);
        setPreviewScopeKey(currentScopeKey);
      },
    });
  }

  const submitError = generate.error ?? previewMutation.error;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent
        className="max-w-2xl"
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter submits from anywhere in the dialog — Enter
          // alone inside the audience search box is separately swallowed
          // in `AudiencePicker` so it never bubbles here as a plain Enter.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            handleGenerateClick(event);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('modal.description')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-5" onSubmit={handleGenerateClick}>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('year.label')}</span>
            <Select value={academicYearId} onValueChange={setAcademicYearId}>
              <SelectTrigger aria-label={t('year.label')}>
                <SelectValue placeholder={t('year.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {academicYears.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Select
                value={periodType}
                onValueChange={(value) => setPeriodType(value as PeriodType)}
              >
                <SelectTrigger aria-label={t('period.typeLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTH">{t('period.month')}</SelectItem>
                  <SelectItem value="WEEK">{t('period.week')}</SelectItem>
                </SelectContent>
              </Select>

              {periodType === 'MONTH' ? (
                <>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger aria-label={t('period.monthLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {t(`months.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={t('period.yearLabel')}
                    type="number"
                    value={calendarYear}
                    onChange={(event) => setCalendarYear(event.target.value)}
                  />
                </>
              ) : (
                <Input
                  aria-label={t('period.weekStartLabel')}
                  type="date"
                  value={weekStart}
                  onChange={(event) => setWeekStart(event.target.value)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('period.dueDateLabel')}</span>
              <Input
                aria-label={t('period.dueDateLabel')}
                type="date"
                value={dueDate}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  setDueDateTouched(true);
                }}
              />
            </div>
          </div>

          <AudiencePicker
            academicYearId={academicYearId}
            selected={selectedStudents}
            onSelectedChange={setSelectedStudents}
          />

          <FeePicker
            academicYearId={academicYearId}
            majorityClassId={majorityClassId(selectedStudents)}
            selected={selectedFees}
            onSelectedChange={setSelectedFees}
            studentCount={studentCount}
          />

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              aria-label={t('notify.label')}
            />
            {t('notify.label')}
          </label>

          {preview && (
            <DuplicatesStep
              preview={preview}
              action={duplicateAction}
              onActionChange={setDuplicateAction}
            />
          )}

          {submitError !== null && submitError !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {describeSubmitError(submitError, t)}
            </p>
          )}

          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t('summary.line', {
                students: studentCount,
                fees: feeCount,
                bills: studentCount * feeCount,
              })}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={resetAndClose}>
                {t('modal.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={!canGenerate}
                loading={previewMutation.isPending || generate.isPending}
              >
                {t('review.submitAction')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
