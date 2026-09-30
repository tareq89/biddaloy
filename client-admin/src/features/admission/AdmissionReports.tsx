/**
 * [39.4.1] Admission reports — the lifecycle report body (D5, D27): year +
 * class filters, four count tiles, an event table (cards on phone via
 * `DataTable`). No export (Epic 8.15 owns that). The route + permission gate
 * (`STUDENT_LIFECYCLE_MANAGE`) is #1200's job.
 *
 * Filter state is local (`useState`) so the screen needs no router; the
 * route ticket may lift it into the URL.
 *
 * Data caveat: ADMITTED rows carry no student (applicants aren't linked to
 * one), so their reg. no. is null and renders as a dash.
 */
import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useAcademicYears, useAdmissionLifecycleReport, useClasses } from '@biddaloy/ui/hooks';
import type { LifecycleReportRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { useState } from 'react';

/** Server cuts the list at this many rows (`truncated`). */
const ROW_LIMIT = 500;

export function AdmissionReports() {
  const { t } = useTranslation('admission-reports');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const yearsQuery = useAcademicYears({ limit: 100 });
  const years = yearsQuery.data?.data ?? [];
  const academicYearId =
    filters.academicYearId || (years.find((y) => y.is_current) ?? years[0])?.id || '';
  const classId = filters.classId || undefined;

  const classesQuery = useClasses(
    { academic_year_id: academicYearId },
    { enabled: Boolean(academicYearId) },
  );
  const reportQuery = useAdmissionLifecycleReport({
    academicYearId,
    ...(classId ? { classId } : {}),
  });
  const report = reportQuery.data;
  const rows = report?.rows ?? [];

  const filterFields: readonly FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'academicYearId',
      label: t('filterYear'),
      allLabel: t('filterCurrentYear'),
      options: years.map((y) => ({ value: y.id, label: y.name })),
    },
    {
      kind: 'select',
      key: 'classId',
      label: t('filterClass'),
      allLabel: t('filterAllClasses'),
      options: (classesQuery.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
  ];

  const dash = t('noValue');
  const columns: DataTableColumn<LifecycleReportRow>[] = [
    { id: 'name', header: t('columnName'), accessorFn: (r) => r.name, card: 'title' },
    {
      id: 'registrationNumber',
      header: t('columnRegistrationNumber'),
      accessorFn: (r) => r.registration_number ?? dash,
      card: 'subtitle',
    },
    { id: 'class', header: t('columnClass'), accessorFn: (r) => r.class_name ?? dash },
    {
      id: 'event',
      header: t('columnEvent'),
      accessorFn: (r) => t(`event${r.event_type}`),
      card: 'badge',
    },
    { id: 'date', header: t('columnDate'), accessorFn: (r) => r.occurred_on },
    { id: 'reason', header: t('columnReason'), accessorFn: (r) => r.reason ?? dash },
    {
      id: 'destination',
      header: t('columnDestination'),
      accessorFn: (r) => r.destination ?? dash,
    },
  ];

  const counts = report?.counts;
  const tiles = [
    { label: t('countAdmitted'), value: counts?.admitted },
    { label: t('countLeft'), value: counts && counts.withdrawn + counts.transferred_out },
    { label: t('countGraduated'), value: counts?.graduated },
    { label: t('countReadmitted'), value: counts?.readmitted },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(patch) =>
          setFilters((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete next[k];
              else next[k] = v;
            }
            // A class belongs to one year: changing year clears it.
            if ('academicYearId' in patch) delete next.classId;
            return next;
          })
        }
      />
      {counts && (
        <dl
          aria-label={t('countsLabel')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="lifecycle-counts"
        >
          {tiles.map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <DataTable
        tableId="admission-reports"
        caption={t('caption')}
        columns={columns}
        data={rows}
        getRowId={(r) =>
          [
            r.event_type,
            r.student_id ?? r.name,
            r.occurred_on,
            r.class_name,
            r.reason,
            r.destination,
          ].join(':')
        }
        sorting={null}
        onSortingChange={() => {}}
        page={1}
        pageSize={ROW_LIMIT}
        totalCount={rows.length}
        onPageChange={() => {}}
        loading={reportQuery.isLoading}
        isFetching={reportQuery.isFetching}
        {...(reportQuery.isError ? { error: t('errorMessage') } : {})}
        emptyMessage={t('emptyMessage')}
      />
      {report?.truncated && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('truncated', { count: ROW_LIMIT })}
        </p>
      )}
    </div>
  );
}
