/**
 * [8.11.6] — `Academic year → Class/Section scope → Month & year →
 * Review → Generate → Summary`, as a `WizardShell` with `irreversible:
 * true`, which makes the review step a *type* requirement rather than a
 * convention (see `wizard-shell.tsx`'s header comment).
 *
 * Two things this screen exists to prevent:
 * - Running a batch write for hundreds of students without seeing the
 *   scope first. There is no dry-run endpoint (`POST /fees/generate` is
 *   the only endpoint there is), so the review step is composed
 *   client-side from what the wizard already knows plus a student count.
 * - The word "skipped" generating support questions forever. It means
 *   "a fee record already exists for that student and month" — the insert
 *   is `ON CONFLICT DO NOTHING` — so the summary spells that out instead
 *   of showing a bare number.
 *
 * Every piece of cross-step state lives here rather than inside the
 * steps: `WizardShell` keeps visited steps mounted-but-hidden, so a
 * failed submit followed by "Back" finds every value still in place.
 */
import { EnrollmentStatus } from '@biddaloy/shared';
import {
  ApiError,
  captureNotificationTenant,
  notifyOutcome,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  studentsQueryOptions,
  useAcademicYears,
  useClasses,
  useClassSections,
  useGenerateFees,
  type AcademicYear,
  type StudentListFilters,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useWizardShellStep, WizardShell, type WizardStep } from '@biddaloy/ui/shells';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';

/** Radix `Select.Item` rejects an empty-string `value` — same "All …"
 * sentinel convention `fees/dues.tsx` and `students/index.tsx` use. */
const ALL_VALUE = '__all__';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** Must include `review` — `useWizardShellStep`'s `setStep` silently
 * no-ops for any id outside this list, and `WizardShell` navigates to the
 * `reviewStep`'s id through that same setter. */
const STEP_IDS = ['year', 'scope', 'period', 'review'] as const;

/** Calendar months since year 0, so an "is this month inside the academic
 * year" comparison is one integer comparison rather than a `Date`
 * construction that would drag day-of-month and time zones into a
 * question that's only about months. Mirrors the server's own check in
 * `fee-generation.service.ts`, which 400s with
 * `Month {m}/{y} is outside academic year …`. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function academicYearBounds(year: AcademicYear) {
  const start = parseServerDate(year.start_date);
  const end = parseServerDate(year.end_date);
  return { start, end };
}

/**
 * Whatever the mutation rejected with, as one sentence an accountant can
 * act on.
 *
 * The 429 case has two shapes, and both have to be handled: `apiClient`
 * turns a throttled response into an `ApiError` carrying the throttler's
 * own `"ThrottlerException: Too Many Requests"` (unusable copy), while
 * `RateLimitedError` — `ui/src/api/errors.ts` — is what the *login* path
 * throws for the same status. Only the first can reach this screen today,
 * but keying the branch on the status rather than the class is what keeps
 * this correct either way.
 *
 * Everything else that's an `ApiError` shows the server's own message:
 * "Month 1/2026 is outside academic year …" and "Class … not found" are
 * more specific than anything this file could write, and
 * `ui/src/api/errors.ts` documents that the server keeps them stable for
 * exactly this use.
 */
function describeSubmitError(error: unknown, t: TFunction<'feeGeneration'>): string {
  if (error instanceof RateLimitedError) return t('errors.rateLimited');
  if (error instanceof ApiError) {
    return error.statusCode === 429 ? t('errors.rateLimited') : error.message;
  }
  return t('errors.unknown');
}

export function GenerateFeesWizard() {
  const { t } = useTranslation('feeGeneration');
  const config = useRegionConfig();
  const navigate = useNavigate();

  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);

  const yearsQuery = useAcademicYears();
  const academicYears = React.useMemo(() => yearsQuery.data?.data ?? [], [yearsQuery.data]);

  const [academicYearId, setAcademicYearId] = React.useState('');
  const [classId, setClassId] = React.useState(ALL_VALUE);
  const [sectionId, setSectionId] = React.useState(ALL_VALUE);
  const [month, setMonth] = React.useState('');
  const [calendarYear, setCalendarYear] = React.useState('');

  const selectedYear = academicYears.find((year) => year.id === academicYearId);

  // Defaults the picker to the school's current year once the list lands,
  // and only then — re-running this after the accountant has chosen a
  // different year would silently undo their choice on any background
  // refetch of the same list.
  React.useEffect(() => {
    if (academicYearId !== '' || academicYears.length === 0) return;
    const current = academicYears.find((year) => year.is_current) ?? academicYears[0];
    if (current) setAcademicYearId(current.id);
  }, [academicYearId, academicYears]);

  // The period defaults to the *first* month of the chosen academic year,
  // not "this month": a default that depends on the wall clock would sit
  // outside the academic year for part of the calendar and land the
  // accountant on an invalid period they didn't choose.
  // Keyed on `academicYearId`, deliberately not on the `selectedYear`
  // object: a background refetch of the year list hands back a new object
  // for the same year, and depending on it would re-run this and quietly
  // throw away a period the accountant had already chosen.
  const yearStart = selectedYear ? academicYearBounds(selectedYear).start : undefined;
  React.useEffect(() => {
    if (!yearStart) return;
    setMonth(String(yearStart.getMonth() + 1));
    setCalendarYear(String(yearStart.getFullYear()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYearId]);

  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== ALL_VALUE ? classId : undefined);

  const bounds = selectedYear ? academicYearBounds(selectedYear) : undefined;

  /** The calendar years the academic year actually touches — a July-start
   * year spans two, a January-start one spans a single year. Offering any
   * other year would only ever produce the server's 400. */
  const calendarYearOptions = bounds
    ? Array.from(
        { length: bounds.end.getFullYear() - bounds.start.getFullYear() + 1 },
        (_, index) => bounds.start.getFullYear() + index,
      )
    : [];

  const periodChosen = month !== '' && calendarYear !== '';
  const periodInsideYear =
    bounds !== undefined &&
    periodChosen &&
    monthIndex(Number(calendarYear), Number(month)) >=
      monthIndex(bounds.start.getFullYear(), bounds.start.getMonth() + 1) &&
    monthIndex(Number(calendarYear), Number(month)) <=
      monthIndex(bounds.end.getFullYear(), bounds.end.getMonth() + 1);

  const countFilters: StudentListFilters = {
    // Deliberately no `academic_year_id`: `QueryStudentDto`
    // (`server/src/modules/students/dto/students.dto.ts`) doesn't accept
    // one, and the global `ValidationPipe`'s `forbidNonWhitelisted` 400s
    // on unknown query params. Class already scopes the year in practice.
    ...(classId !== ALL_VALUE ? { class_id: classId } : {}),
    ...(sectionId !== ALL_VALUE ? { section_id: sectionId } : {}),
    // Only ACTIVE, non-deleted students are evaluated server-side
    // (`fee-generation.service.ts`) — a count that included transferred or
    // graduated students would overstate the scope.
    enrollment_status: EnrollmentStatus.ACTIVE,
    // The rows are never rendered; only `total` is. One row is the
    // smallest page the endpoint will return.
    limit: 1,
  };

  // Gated on the review step rather than running from mount: before the
  // scope is chosen the count would be a tenant-wide query whose answer
  // nothing on screen shows.
  const countQuery = useQuery({
    ...studentsQueryOptions(countFilters),
    enabled: stepId === 'review',
  });

  const generateFees = useGenerateFees();

  const selectedClass = classesQuery.data?.data.find((klass) => klass.id === classId);
  const selectedSection = sectionsQuery.data?.find((section) => section.id === sectionId);

  function handleSubmit() {
    if (!selectedYear || !periodInsideYear) return;
    const notifyTenantId = captureNotificationTenant();
    generateFees.mutate(
      {
        academic_year_id: selectedYear.id,
        month: Number(month),
        year: Number(calendarYear),
        ...(classId !== ALL_VALUE ? { class_id: classId } : {}),
        ...(sectionId !== ALL_VALUE ? { section_id: sectionId } : {}),
      },
      {
        onSuccess: (result) =>
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'success',
            message: t('notifications.generated', {
              generated: result.generated,
              skipped: result.skipped,
            }),
          }),
        onError: () =>
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'error',
            message: t('notifications.failed'),
          }),
      },
    );
  }

  /**
   * Any change to the wizard's inputs invalidates the last failed submit:
   * the alert on the review panel names a month and a scope, and leaving
   * it up after the accountant has changed either one reports a failure
   * that no longer describes what they're about to send.
   */
  function clearStaleSubmitError() {
    if (generateFees.isError) generateFees.reset();
  }

  function handleRunAgain() {
    generateFees.reset();
    setStepId('year');
  }

  const submitError = generateFees.error;

  const steps: WizardStep[] = [
    {
      id: 'year',
      label: t('steps.year'),
      content: (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('year.label')}</span>
          <Select
            value={academicYearId}
            onValueChange={(value) => {
              setAcademicYearId(value);
              // Classes and sections belong to one academic year. Keeping
              // the old class would submit an id the new year doesn't
              // contain — and, because it also drops out of
              // `classesQuery.data`, the review panel would label the
              // scope "All classes" while still sending that class id.
              setClassId(ALL_VALUE);
              setSectionId(ALL_VALUE);
              clearStaleSubmitError();
            }}
          >
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
          {bounds && (
            <p className="text-xs text-muted-foreground">
              {t('year.range', {
                start: formatDate(bounds.start, config),
                end: formatDate(bounds.end, config),
              })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('year.hint')}</p>
        </div>
      ),
      isValid: () => academicYearId !== '',
    },
    {
      id: 'scope',
      label: t('steps.scope'),
      content: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('scope.classLabel')}</span>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                // A section only exists inside a class — keeping the old
                // one would submit a section that isn't in the new class.
                setSectionId(ALL_VALUE);
                clearStaleSubmitError();
              }}
            >
              <SelectTrigger aria-label={t('scope.classLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('scope.allClasses')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {classId !== ALL_VALUE && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('scope.sectionLabel')}</span>
              <Select
                value={sectionId}
                onValueChange={(value) => {
                  setSectionId(value);
                  clearStaleSubmitError();
                }}
              >
                <SelectTrigger aria-label={t('scope.sectionLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>{t('scope.allSections')}</SelectItem>
                  {sectionsQuery.data?.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{t('scope.hint')}</p>
        </div>
      ),
    },
    {
      id: 'period',
      label: t('steps.period'),
      content: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('period.monthLabel')}</span>
            <Select
              value={month}
              onValueChange={(value) => {
                setMonth(value);
                clearStaleSubmitError();
              }}
            >
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
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('period.yearLabel')}</span>
            <Select
              value={calendarYear}
              onValueChange={(value) => {
                setCalendarYear(value);
                clearStaleSubmitError();
              }}
            >
              <SelectTrigger aria-label={t('period.yearLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendarYearOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {String(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The same rejection the server would answer with, said before
           * the request instead of after it — `isValid` below keeps
           * "Next" disabled while this is on screen. */}
          {selectedYear && bounds && periodChosen && !periodInsideYear && (
            <p role="alert" className="text-sm text-destructive">
              {t('period.outsideYear', {
                month: t(`months.${month}`),
                year: calendarYear,
                name: selectedYear.name,
                start: formatDate(bounds.start, config),
                end: formatDate(bounds.end, config),
              })}
            </p>
          )}
        </div>
      ),
      isValid: () => periodInsideYear,
    },
  ];

  return (
    <WizardShell
      title={t('title')}
      steps={steps}
      currentStepId={stepId}
      onStepChange={setStepId}
      irreversible
      reviewStep={{
        id: 'review',
        label: t('steps.review'),
        content: (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">{t('review.heading')}</h2>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('review.academicYearLabel')}</dt>
              <dd>{selectedYear?.name ?? ''}</dd>
              <dt className="text-muted-foreground">{t('review.classLabel')}</dt>
              {/* Keyed off the chosen value, not off `classesQuery.data`:
               * while that list refetches, `selectedClass` is briefly
               * undefined and a `?? allClasses` fallback would claim a
               * wider scope than the one about to be submitted. */}
              <dd>{classId === ALL_VALUE ? t('scope.allClasses') : (selectedClass?.name ?? '')}</dd>
              <dt className="text-muted-foreground">{t('review.sectionLabel')}</dt>
              <dd>
                {sectionId === ALL_VALUE
                  ? t('scope.allSections')
                  : (selectedSection?.section_name ?? '')}
              </dd>
              <dt className="text-muted-foreground">{t('review.periodLabel')}</dt>
              <dd>
                {month !== ''
                  ? t('review.period', { month: t(`months.${month}`), year: calendarYear })
                  : ''}
              </dd>
            </dl>

            {countQuery.isPending && <p className="text-sm">{t('review.countLoading')}</p>}
            {countQuery.isError && <p className="text-sm">{t('review.countFailed')}</p>}
            {countQuery.isSuccess && (
              <p className="text-sm font-medium">
                {t('review.count', { count: countQuery.data.total })}
              </p>
            )}

            {/* The honesty clause. The count is students *evaluated*, and
             * a student whose applicable total comes to zero is counted
             * in neither `generated` nor `skipped` server-side — so this
             * must never read as a promise of N fee records. */}
            <p className="text-sm text-muted-foreground">{t('review.estimateNote')}</p>

            {submitError !== null && submitError !== undefined && (
              <p role="alert" className="text-sm text-destructive">
                {describeSubmitError(submitError, t)}
              </p>
            )}
          </div>
        ),
        isValid: () => Boolean(selectedYear) && periodInsideYear,
      }}
      // Mirrors `handleSubmit`'s guard. Without it, deep-linking to
      // `?step=review` mounts only this panel — skipping every earlier
      // step's `isValid` — and leaves "Generate fees" enabled while the
      // academic years are still loading, so each click is a silent no-op.
      onSubmit={handleSubmit}
      submitLabel={t('review.submitAction')}
      // Never optimistic: the button disables and reports `aria-busy`
      // until the server answers, and nothing about the outcome is on
      // screen before then.
      submitting={generateFees.isPending}
      result={
        generateFees.isSuccess ? (
          <div role="status" className="flex flex-col gap-4">
            <h2 className="text-base font-medium">{t('result.title')}</h2>

            <ul className="flex flex-col gap-1 text-sm">
              <li>{t('result.generated', { count: generateFees.data.generated })}</li>
              <li>{t('result.skipped', { count: generateFees.data.skipped })}</li>
              <li>{t('result.evaluated', { count: generateFees.data.students_evaluated })}</li>
            </ul>

            {generateFees.data.generated === 0 && (
              <p className="text-sm">{t('result.nothingGenerated')}</p>
            )}

            {/* The one sentence this whole screen exists for. */}
            <p className="text-sm text-muted-foreground">{t('result.skippedExplainer')}</p>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleRunAgain}>
                {t('result.runAgain')}
              </Button>
              <Button type="button" onClick={() => void navigate({ to: '/fees/dues' })}>
                {t('result.goToDues')}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}
