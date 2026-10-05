/**
 * [39.4.1] Admission reports — the lifecycle report body (D5, D27): year +
 * class filters, four count tiles, an event table (cards on phone via
 * `DataTable`). No export (Epic 8.15 owns that). The route + permission gate
 * (`STUDENT_LIFECYCLE_MANAGE`) is #1200's job.
 *
 * Filter state is local (`useState`) so the screen needs no router, and paging
 * happens on the client over the (at most 500) rows the server returns.
 *
 * Data caveat: ADMITTED rows carry no student (applicants aren't linked to
 * one), so their reg. no. is null and renders as a dash.
 */
import { Permission } from '@biddaloy/shared';
import { DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAdmissionLifecycleReport,
  useClasses,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import type { LifecycleReportRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { InfoIcon } from 'lucide-react';
import { useState } from 'react';

/** Server cuts the list at this many rows (`truncated`). */
const ROW_LIMIT = 500;

/** Joined = success, finished = info, left = neutral (leaving is not a failure). */
const EVENT_TONE = {
  ADMITTED: 'success',
  READMITTED: 'success',
  GRADUATED: 'info',
  WITHDRAWN: 'neutral',
  TRANSFERRED_OUT: 'neutral',
} as const;

export function AdmissionReports() {
  const { t } = useTranslation('admission-reports');
  const regionConfig = useRegionConfig();
  const canReadStudents = useHasPermission(Permission.STUDENT_READ);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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
  const year = years.find((y) => y.id === academicYearId);
  const className = (classesQuery.data?.data ?? []).find((c) => c.id === classId)?.name;

  const filterFields: readonly FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'academicYearId',
      label: t('filterYear'),
      allLabel: t('filterCurrentYear', {
        name: (years.find((y) => y.is_current) ?? years[0])?.name ?? '',
      }),
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
      accessorFn: (r) => (
        <StatusBadge tone={EVENT_TONE[r.event_type]} label={t(`event${r.event_type}`)} />
      ),
      card: 'badge',
    },
    {
      id: 'date',
      header: t('columnDate'),
      accessorFn: (r) => formatDate(r.occurred_on, regionConfig),
    },
    { id: 'reason', header: t('columnReason'), accessorFn: (r) => r.reason ?? dash },
    {
      id: 'destination',
      header: t('columnDestination'),
      accessorFn: (r) => r.destination ?? dash,
    },
  ];

  const counts = report?.counts;
  const fmt = (n: number | undefined) => (n === undefined ? '' : formatNumber(n, regionConfig));
  const tiles = [
    { label: t('countAdmitted'), value: counts?.admitted },
    {
      label: t('countLeft'),
      value: counts && counts.withdrawn + counts.transferred_out,
      detail:
        counts &&
        t('countLeftDetail', {
          withdrawn: fmt(counts.withdrawn),
          transferred: fmt(counts.transferred_out),
        }),
    },
    { label: t('countGraduated'), value: counts?.graduated },
    { label: t('countReadmitted'), value: counts?.readmitted },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('title')}
        subtitle={
          year
            ? t('subtitle', { year: year.name, class: className ?? t('filterAllClasses') })
            : undefined
        }
      />
      <FilterBar
        fields={filterFields}
        values={filters}
        onChange={(patch) => {
          setPage(1);
          setFilters((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete next[k];
              else next[k] = v;
            }
            // A class belongs to one year: changing year clears it.
            if ('academicYearId' in patch) delete next.classId;
            return next;
          });
        }}
      />
      {(counts || reportQuery.isLoading) && (
        <dl
          aria-label={t('countsLabel')}
          aria-busy={reportQuery.isLoading}
          className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"
          data-testid="lifecycle-counts"
        >
          {tiles.map(({ label, value, detail }) => (
            <div
              key={label}
              className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
            >
              <dt className="text-label text-text-secondary">{label}</dt>
              {value === undefined ? (
                <dd className="mt-2 block h-7 w-12 rounded-sm bg-muted" />
              ) : (
                <dd className="mt-1 text-h1 tabular-nums">{fmt(value)}</dd>
              )}
              {detail && <dd className="mt-0.5 text-caption text-text-secondary">{detail}</dd>}
            </div>
          ))}
        </dl>
      )}
      <DataTable
        tableId="admission-reports"
        caption={t('caption')}
        columns={columns}
        data={rows.slice((page - 1) * pageSize, page * pageSize)}
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
        page={page}
        pageSize={pageSize}
        totalCount={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        rowActions={(r) => [
          {
            intent: 'view',
            label: t('viewStudent'),
            to: `/students/${r.student_id}`,
            allowed: Boolean(r.student_id) && canReadStudents,
          },
        ]}
        loading={reportQuery.isLoading}
        isFetching={reportQuery.isFetching}
        {...(reportQuery.isError ? { error: t('errorMessage') } : {})}
        emptyState={{ title: t('emptyMessage'), explanation: t('emptyExplanation') }}
      />
      {report?.truncated && (
        <p role="status" className="flex items-center gap-1.5 text-caption text-text-secondary">
          <InfoIcon className="size-4 shrink-0" aria-hidden />
          {t('truncated', { count: formatNumber(ROW_LIMIT, regionConfig) })}
        </p>
      )}
    </PageContainer>
  );
}
