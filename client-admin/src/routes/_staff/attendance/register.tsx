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
import {
  EmptyState,
  ErrorState,
  Label,
  MonthPicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TableCount,
} from '@biddaloy/ui/components';
import { useClasses, useClassSections, useRegisterMatrix } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatMonth, formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { FileSpreadsheet, PrinterIcon } from 'lucide-react';
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

/** Letter shown in a day cell. Literal keys (not a computed `t()` key) so
 * `check-i18n-keys.mjs` can see them. An unknown status shows "?". */
function abbrev(t: ReturnType<typeof useTranslation>['t'], status: AttendanceStatus): string {
  switch (status) {
    case AttendanceStatus.PRESENT:
      return t('register.abbrev.PRESENT');
    case AttendanceStatus.ABSENT:
      return t('register.abbrev.ABSENT');
    case AttendanceStatus.LATE:
      return t('register.abbrev.LATE');
    case AttendanceStatus.LEAVE:
      return t('register.abbrev.LEAVE');
    default:
      return '?';
  }
}

function toneClass(status: AttendanceStatus | null | undefined): string {
  if (status === AttendanceStatus.ABSENT) return 'font-semibold text-status-overdue-fg';
  if (status === AttendanceStatus.LATE) return 'text-status-due-fg';
  if (status === AttendanceStatus.LEAVE) return 'text-status-partial-fg';
  return '';
}

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
      // `HALF_DAY`) must not render as an empty cell, nor as a raw enum.
      return t('register.unknownStatus');
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

  const rows = matrixQuery.data?.rows ?? [];
  const monthLabel = formatMonth(month, regionConfig);
  const names = { className: className ?? '', sectionName: sectionName ?? '' };
  const caption = t('register.caption', { ...names, month: monthLabel });
  const cardTitle = t('register.cardTitle', { ...names, month: monthLabel });

  return (
    <PageContainer>
      <PageHeader
        title={t('register.title')}
        subtitle={t('register.subtitle')}
        actions={[
          {
            id: 'print',
            label: t('register.print'),
            icon: <PrinterIcon aria-hidden="true" />,
            priority: 'primary',
            disabled: rows.length === 0,
            onClick: () => window.print(),
          },
        ]}
      />

      <section aria-label={t('register.pickersLabel')} className="grid gap-4 md:grid-cols-12">
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-class">{t('register.classLabel')}</Label>
          <Select
            value={search.class_id ?? ''}
            onValueChange={(value) => patchSearch({ class_id: value, section_id: undefined })}
          >
            <SelectTrigger id="register-class">
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <SelectItem key={klass.id} value={klass.id}>
                  {klass.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-section">{t('register.sectionLabel')}</Label>
          <Select
            value={search.section_id ?? ''}
            onValueChange={(value) => patchSearch({ section_id: value })}
            disabled={search.class_id === undefined}
          >
            <SelectTrigger id="register-section" disabled={search.class_id === undefined}>
              <SelectValue placeholder={t('register.pickPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(sectionsQuery.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.section_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="register-month">{t('register.monthLabel')}</Label>
          <MonthPicker
            id="register-month"
            aria-label={t('register.monthLabel')}
            value={month}
            onValueChange={(value) => patchSearch({ month: value })}
          />
        </div>
      </section>

      {search.section_id === undefined ? (
        <EmptyState
          icon={<FileSpreadsheet />}
          title={t('register.pickTitle')}
          explanation={t('register.selectPrompt')}
        />
      ) : matrixQuery.isPending ? (
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">{t('register.loading')}</span>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : matrixQuery.isError ? (
        <ErrorState
          message={t('register.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void matrixQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('register.emptyMessage')}
          explanation={t('register.emptyExplanation')}
        />
      ) : (
        <section
          id="attendance-register-print-area"
          aria-labelledby="r-title"
          className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
        >
          <div className="flex flex-col gap-2 border-b border-border-subtle p-4 md:flex-row md:items-center md:justify-between md:px-5">
            <h2 id="r-title" className="text-h3">
              {cardTitle}
            </h2>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-text-secondary">
              {[
                AttendanceStatus.PRESENT,
                AttendanceStatus.ABSENT,
                AttendanceStatus.LATE,
                AttendanceStatus.LEAVE,
              ].map((status) => (
                <span key={status}>
                  {abbrev(t, status)} = {statusLabel(t, status)}
                </span>
              ))}
              <span>{t('register.legendClosed')}</span>
              <span>{t('register.legendUnmarked')}</span>
            </p>
          </div>
          <p className="px-4 py-3 text-caption text-text-secondary md:hidden print:hidden">
            {t('register.scrollHint')}
          </p>
          <div
            role="region"
            aria-label={caption}
            // WCAG SCR29: a scrollable `role="region"` needs a tab stop so a
            // keyboard user can scroll it — same exemption `data-table.tsx`'s
            // own table-mode wrapper carries, for the identical reason.
            // `relative`: the `sr-only` header spans are `position: absolute`
            // and would otherwise escape the `overflow-x-auto` and widen the page.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="relative w-full overflow-x-auto"
          >
            <table className="w-full border-collapse text-caption tabular-nums">
              <caption className="sr-only">{caption}</caption>
              <thead className="border-b border-border-subtle bg-muted text-text-secondary">
                <tr>
                  <th scope="col" className="h-9 px-2 text-start font-medium">
                    {t('register.columnRoll')}
                  </th>
                  <th scope="col" className="h-9 px-2 text-start font-medium">
                    {t('register.columnStudent')}
                  </th>
                  {matrixQuery.data?.dates.map((date) => (
                    <th key={date.date} scope="col" className="h-9 min-w-6 text-center font-medium">
                      <span aria-hidden="true">
                        {formatNumber(parseServerDate(date.date).getUTCDate(), regionConfig)}
                      </span>
                      <span className="sr-only">{formatDate(date.date, regionConfig)}</span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="h-9 border-s border-border-subtle px-2 text-end font-medium"
                  >
                    {t('register.totalPresent')}
                  </th>
                  <th scope="col" className="h-9 px-2 text-end font-medium">
                    {t('register.totalAbsent')}
                  </th>
                  <th scope="col" className="h-9 px-2 text-end font-medium">
                    {t('register.totalLate')}
                  </th>
                  <th scope="col" className="h-9 px-2 text-end font-medium">
                    {t('register.totalLeave')}
                  </th>
                  <th scope="col" className="h-9 px-2 text-end font-medium">
                    {t('register.totalPercentage')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((row) => (
                  <tr key={row.student_id}>
                    <td className="h-9 px-2">{formatNumber(row.roll_number, regionConfig)}</td>
                    <td className="h-9 px-2 font-medium whitespace-nowrap">{row.full_name}</td>
                    {matrixQuery.data?.dates.map((date) => {
                      const status = (row.marks as Record<string, AttendanceStatus | null>)[
                        date.date
                      ];
                      if (!date.is_working_day) {
                        return (
                          <td
                            key={date.date}
                            className="h-9 bg-muted text-center text-text-secondary"
                          >
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{t('register.notWorkingDay')}</span>
                          </td>
                        );
                      }
                      return (
                        <td key={date.date} className={`h-9 text-center ${toneClass(status)}`}>
                          <span aria-hidden="true">{status ? abbrev(t, status) : '·'}</span>
                          <span className="sr-only">
                            {status ? statusLabel(t, status) : t('register.notMarked')}
                          </span>
                        </td>
                      );
                    })}
                    <td className="h-9 border-s border-border-subtle px-2 text-end">
                      {formatNumber(row.summary.present_days, regionConfig)}
                    </td>
                    <td className="h-9 px-2 text-end">
                      {formatNumber(row.summary.absent_days, regionConfig)}
                    </td>
                    <td className="h-9 px-2 text-end">
                      {formatNumber(row.summary.late_days, regionConfig)}
                    </td>
                    <td className="h-9 px-2 text-end">
                      {formatNumber(row.summary.leave_days, regionConfig)}
                    </td>
                    <td className="h-9 px-2 text-end">
                      {row.summary.attendance_percentage === null
                        ? '—'
                        : `${formatNumber(row.summary.attendance_percentage, regionConfig)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border-subtle px-4 py-3">
            <TableCount total={rows.length} />
          </div>
        </section>
      )}
    </PageContainer>
  );
}
