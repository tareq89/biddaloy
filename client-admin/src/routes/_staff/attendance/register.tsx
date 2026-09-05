/**
 * [9.10] `/attendance/register` — a printable, paper-register replacement
 * for one section's whole month, over `GET /attendance/sections/
 * :sectionId/register-matrix` ([9.4]'s `useRegisterMatrix`, already used
 * by `reports.tsx`'s summary view). Client-only: no new backend surface.
 *
 * Deliberately a hand-written `<table>`, not `DataTable` — a
 * date-by-student matrix (one column per calendar day, up to 31 of them)
 * is not a list-of-rows-with-a-fixed-column-set the way every other
 * `DataTable` caller's data is, and `DataTable`'s column-visibility/
 * card-mode/sort machinery has nothing useful to offer a grid shaped like
 * this. It does still borrow `DataTable`'s design tokens (`text-sm`,
 * `border-border-subtle`, `tabular-nums`) so it reads as the same
 * product, not a one-off.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useClasses, useClassSections, useRegisterMatrix } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import './-register-print.css';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const searchSchema = z.object({
  class_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
  month: z
    .string()
    .regex(MONTH_PATTERN)
    .optional()
    .catch(() => undefined),
});

export const Route = createFileRoute('/_staff/attendance/register')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('attendance', 'common'),
  component: RegisterPage,
});

const STATUS_ABBREV: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: 'P',
  [AttendanceStatus.ABSENT]: 'A',
  [AttendanceStatus.LATE]: 'L',
  [AttendanceStatus.LEAVE]: 'V',
};

/** Literal per-status lookup, not `t(\`statusControl.status.${status}\`)` —
 * a computed key is invisible to `check-i18n-keys.mjs` (same reasoning
 * `attendance-month-grid.tsx`'s own `stateLabel` documents). Reuses
 * `statusControl.status.*` — [9.6]'s existing keys for the same four
 * enum members — rather than a second copy under `register.*`. */
function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: AttendanceStatus): string {
  switch (status) {
    case AttendanceStatus.PRESENT:
      return t('statusControl.status.PRESENT');
    case AttendanceStatus.ABSENT:
      return t('statusControl.status.ABSENT');
    case AttendanceStatus.LATE:
      return t('statusControl.status.LATE');
    case AttendanceStatus.LEAVE:
      return t('statusControl.status.LEAVE');
    default:
      // `row.marks` is cast (not validated) from server JSON — a status
      // member this client doesn't know about yet (e.g. a future
      // `HALF_DAY`) must not render as an empty cell. Show it raw rather
      // than silently dropping the mark.
      return status;
  }
}

function RegisterPage() {
  // `useRegionConfig()` has no ambient provider above the route tree —
  // same wrap `academic-years/index.tsx` documents for itself.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <RegisterPageContent />
    </RegionConfigProvider>
  );
}

function RegisterPageContent() {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const month = search.month ?? currentMonthIso();

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(search.class_id);
  const matrixQuery = useRegisterMatrix(search.section_id, month);

  const className = classesQuery.data?.data.find((klass) => klass.id === search.class_id)?.name;
  const sectionName = sectionsQuery.data?.find(
    (section) => section.id === search.section_id,
  )?.section_name;

  function patchSearch(
    patch: Partial<Record<'class_id' | 'section_id' | 'month', string | undefined>>,
  ) {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <h1 className="text-lg font-semibold">{t('register.title')}</h1>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t('register.classLabel')}
            <select
              className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
              value={search.class_id ?? ''}
              onChange={(event) =>
                patchSearch({
                  class_id: event.target.value || undefined,
                  section_id: undefined,
                })
              }
            >
              <option value="">{t('reports.allClasses')}</option>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('register.sectionLabel')}
            <select
              className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
              value={search.section_id ?? ''}
              onChange={(event) => patchSearch({ section_id: event.target.value || undefined })}
            >
              <option value="">{t('reports.allSections')}</option>
              {(sectionsQuery.data ?? []).map((section) => (
                <option key={section.id} value={section.id}>
                  {section.section_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('register.monthLabel')}
            <input
              type="month"
              className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
              value={month}
              onChange={(event) => patchSearch({ month: event.target.value || undefined })}
            />
          </label>
          <Button
            type="button"
            disabled={search.section_id === undefined}
            onClick={() => window.print()}
          >
            <PrinterIcon className="size-4" aria-hidden="true" />
            {t('register.print')}
          </Button>
        </div>
      </div>

      {search.section_id === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('register.selectPrompt')}
        </p>
      ) : matrixQuery.isPending ? (
        <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
          <span className="sr-only">{t('register.loading')}</span>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : matrixQuery.isError ? (
        <ErrorState
          message={t('register.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void matrixQuery.refetch()}
        />
      ) : matrixQuery.data.rows.length === 0 ? (
        <EmptyState
          title={t('register.title')}
          explanation={t('register.emptyMessage')}
          action={{
            label: t('actions.retry', { ns: 'common' }),
            onClick: () => void matrixQuery.refetch(),
          }}
        />
      ) : (
        <div
          id="attendance-register-print-area"
          role="region"
          aria-label={t('register.caption', {
            className: className ?? '',
            sectionName: sectionName ?? '',
            month,
          })}
          // WCAG SCR29: a scrollable `role="region"` needs a tab stop so a
          // keyboard user can scroll it — same exemption `data-table.tsx`'s
          // own table-mode wrapper carries, for the identical reason.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="w-full overflow-x-auto rounded-lg border border-border-subtle"
        >
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="p-2 text-start text-sm font-semibold">
              {t('register.caption', {
                className: className ?? '',
                sectionName: sectionName ?? '',
                month,
              })}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="p-1.5 text-start font-medium">
                  {t('register.columnRoll')}
                </th>
                <th scope="col" className="p-1.5 text-start font-medium">
                  {t('register.columnStudent')}
                </th>
                {matrixQuery.data.dates.map((date) => (
                  <th key={date.date} scope="col" className="p-1 text-center font-medium">
                    <span aria-hidden="true">{parseServerDate(date.date).getUTCDate()}</span>
                    <span className="sr-only">{date.date}</span>
                  </th>
                ))}
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('register.totalPresent')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('register.totalAbsent')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('register.totalLate')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('register.totalLeave')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('register.totalPercentage')}
                </th>
              </tr>
            </thead>
            <tbody>
              {matrixQuery.data.rows.map((row) => (
                <tr key={row.student_id} className="border-b border-border-subtle">
                  <td className="p-1.5">{formatNumber(row.roll_number, regionConfig)}</td>
                  <td className="p-1.5">{row.full_name}</td>
                  {matrixQuery.data.dates.map((date) => {
                    const status = (row.marks as Record<string, AttendanceStatus | null>)[
                      date.date
                    ];
                    const label = !date.is_working_day
                      ? t('register.notWorkingDay')
                      : status
                        ? statusLabel(t, status)
                        : t('register.notMarked');
                    const abbrev = !date.is_working_day
                      ? '—'
                      : status
                        ? (STATUS_ABBREV[status] ?? '?')
                        : '·';
                    return (
                      <td key={date.date} className="p-1 text-center">
                        <span aria-hidden="true">{abbrev}</span>
                        <span className="sr-only">{label}</span>
                      </td>
                    );
                  })}
                  <td className="p-1.5 text-end">
                    {formatNumber(row.summary.present_days, regionConfig)}
                  </td>
                  <td className="p-1.5 text-end">
                    {formatNumber(row.summary.absent_days, regionConfig)}
                  </td>
                  <td className="p-1.5 text-end">
                    {formatNumber(row.summary.late_days, regionConfig)}
                  </td>
                  <td className="p-1.5 text-end">
                    {formatNumber(row.summary.leave_days, regionConfig)}
                  </td>
                  <td className="p-1.5 text-end">
                    {row.summary.attendance_percentage === null
                      ? '—'
                      : `${formatNumber(row.summary.attendance_percentage, regionConfig)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
