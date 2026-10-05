/**
 * [19.11.1] — the guardian/student portal's exam timetable. Cloned from
 * `portal/fees.tsx`'s shell and reuses the same `StudentPicker` multi-child
 * selector `portal/results.tsx` (#905) already reuses — no third instance
 * of that component.
 *
 * Visibility is entirely server-side (`ExamSchedulesService.listForFamily`
 * / `StudentExamScheduleController`): an exam's rows only ever appear here
 * once its schedule is complete. This page has nothing to grey out or
 * hide — an incomplete exam simply isn't in the response.
 *
 * Layout: one table card per exam (rows by date, past ones muted with a
 * "Finished" badge), and the next sitting in its own card — first on a
 * phone, in the right column on desktop. Region config comes from a
 * value-less `RegionConfigProvider` (same reasoning as `fees.tsx`).
 */
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentExamSchedule,
  type Student,
  type StudentExamScheduleRow,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatTime,
  formatWeekday,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CalendarDaysIcon, ClockIcon, FileClockIcon, MapPinIcon } from 'lucide-react';
import type * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

const examScheduleSearchSchema = z.object({
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/exam-schedule')({
  validateSearch: examScheduleSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'exams'),
    ]),
  pendingComponent: PortalExamSchedulePending,
  component: PortalExamScheduleRoute,
});

function PortalExamScheduleRoute() {
  return (
    <RegionConfigProvider>
      <PortalExamSchedule />
    </RegionConfigProvider>
  );
}

function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
}

/** The sort the API already applies, kept client-side so the page stays
 * correct if a caching layer ever reorders the response. */
function bySitting(a: StudentExamScheduleRow, b: StudentExamScheduleRow): number {
  return a.date !== b.date ? a.date.localeCompare(b.date) : a.starts_at.localeCompare(b.starts_at);
}

interface ExamGroup {
  exam: StudentExamScheduleRow['exam'];
  rows: StudentExamScheduleRow[];
}

function groupByExam(rows: StudentExamScheduleRow[]): ExamGroup[] {
  const groups = new Map<string, ExamGroup>();
  for (const row of rows.slice().sort(bySitting)) {
    const group = groups.get(row.exam.id) ?? { exam: row.exam, rows: [] };
    group.rows.push(row);
    groups.set(row.exam.id, group);
  }
  // Rows are already sorted, so each group's first row is its earliest.
  return [...groups.values()].sort((a, b) => bySitting(a.rows[0]!, b.rows[0]!));
}

function PortalExamSchedule() {
  const { t } = useTranslation('portal');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const scheduleQuery = useStudentExamSchedule(selected?.id);

  if (studentsQuery.isPending) return <ExamScheduleSkeleton label={t('examSchedule.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('examSchedule.error.message')}
        retryLabel={t('examSchedule.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer>
        <PageHeader title={t('examSchedule.title')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  if (scheduleQuery.isPending) {
    return (
      <ExamScheduleSkeleton label={t('examSchedule.loading')} showPicker={students.length > 1} />
    );
  }

  if (scheduleQuery.isError) {
    return (
      <ErrorState
        message={t('examSchedule.error.message')}
        retryLabel={t('examSchedule.error.retry')}
        onRetry={() => void scheduleQuery.refetch()}
      />
    );
  }

  const todayIso = toIsoDate(new Date());
  const groups = groupByExam(scheduleQuery.data);
  const next = groups
    .flatMap((group) => group.rows)
    .sort(bySitting)
    .find((row) => row.date >= todayIso);

  // The server's own bn/en subject names; each falls back to the other. A
  // row with no subject says so instead of showing an id.
  const isBangla = config.locale.startsWith('bn');
  const subjectLabel = (row: StudentExamScheduleRow): string => {
    const subject = row.subject;
    const name = subject
      ? isBangla
        ? subject.name_bn || subject.name_en
        : subject.name_en || subject.name_bn
      : '';
    return name || t('examSchedule.unknownSubject');
  };
  const dateLabel = (date: string) => `${formatWeekday(date, config)}, ${formatDate(date, config)}`;
  const timeLabel = (row: StudentExamScheduleRow) =>
    `${formatTime(row.starts_at, config)} – ${formatTime(row.ends_at, config)}`;

  return (
    <PageContainer>
      <PageHeader
        title={t('examSchedule.title')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
      {students.length > 1 && (
        <StudentPicker
          label={t('fees.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/exam-schedule"
        />
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<FileClockIcon />}
          title={t('examSchedule.emptyTitle')}
          explanation={t('examSchedule.emptyExplanation')}
        />
      ) : (
        <div className="flex flex-col gap-6 md:grid md:grid-cols-3 md:items-start">
          {next !== undefined && (
            <Card asChild>
              <aside className="p-4 md:order-2 md:p-5" aria-labelledby="exam-next-title">
                <h2 id="exam-next-title" className="text-label text-text-secondary">
                  {t('examSchedule.next.title')}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-h2">{subjectLabel(next)}</span>
                  {next.date === todayIso && (
                    <StatusBadge tone="info" label={tCommon('date.today')} />
                  )}
                </p>
                <p className="text-text-secondary">{next.exam.name}</p>
                <dl className="mt-4 space-y-3 border-t border-border-subtle pt-4">
                  <NextRow icon={<CalendarDaysIcon />} label={t('examSchedule.columns.date')}>
                    {dateLabel(next.date)}
                  </NextRow>
                  <NextRow icon={<ClockIcon />} label={t('examSchedule.columns.time')}>
                    {timeLabel(next)}
                  </NextRow>
                  {next.venue && (
                    <NextRow icon={<MapPinIcon />} label={t('examSchedule.columns.venue')}>
                      {next.venue}
                    </NextRow>
                  )}
                </dl>
              </aside>
            </Card>
          )}
          <div className="min-w-0 space-y-6 md:order-1 md:col-span-2">
            {groups.map((group) => (
              <ExamTableCard
                key={group.exam.id}
                group={group}
                todayIso={todayIso}
                config={config}
                dateLabel={dateLabel}
                timeLabel={timeLabel}
                subjectLabel={subjectLabel}
              />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function NextRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="mt-0.5 text-text-secondary [&_svg]:size-4">
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExamTableCard({
  group,
  todayIso,
  config,
  dateLabel,
  timeLabel,
  subjectLabel,
}: {
  group: ExamGroup;
  todayIso: string;
  config: RegionConfig;
  dateLabel: (date: string) => string;
  timeLabel: (row: StudentExamScheduleRow) => string;
  subjectLabel: (row: StudentExamScheduleRow) => string;
}) {
  const { t } = useTranslation('portal');
  const { t: tCommon } = useTranslation('common');
  const first = group.rows[0]!;
  const last = group.rows[group.rows.length - 1]!;
  // Past sittings read muted; the badge carries the state as text too.
  const muted = (row: StudentExamScheduleRow) => (row.date < todayIso ? 'text-text-secondary' : '');

  const columns: DataTableColumn<StudentExamScheduleRow>[] = [
    {
      id: 'date',
      header: t('examSchedule.columns.date'),
      card: 'subtitle',
      accessorFn: (row) => (
        <span className={`whitespace-nowrap ${muted(row)}`}>{dateLabel(row.date)}</span>
      ),
    },
    {
      id: 'time',
      header: t('examSchedule.columns.time'),
      accessorFn: (row) => (
        <span className={`whitespace-nowrap ${muted(row)}`}>{timeLabel(row)}</span>
      ),
    },
    {
      id: 'subject',
      header: t('examSchedule.columns.subject'),
      card: 'title',
      accessorFn: (row) => (
        <span className={`flex items-center gap-2 font-medium ${muted(row)}`}>
          {subjectLabel(row)}
          {row.date < todayIso && <StatusBadge tone="neutral" label={t('examSchedule.done')} />}
          {row.date === todayIso && <StatusBadge tone="info" label={tCommon('date.today')} />}
        </span>
      ),
    },
    {
      id: 'venue',
      header: t('examSchedule.columns.venue'),
      accessorFn: (row) => <span className={muted(row)}>{row.venue ?? '—'}</span>,
    },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 py-3 md:px-5">
        <h2 className="text-h2">{group.exam.name}</h2>
        <p className="text-text-secondary">{formatDateRange(first.date, last.date, config)}</p>
      </div>
      <DataTable
        tableId={`portal-exam-${group.exam.id}`}
        caption={group.exam.name}
        columns={columns}
        data={group.rows}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={noop}
        paginated={false}
        totalCount={group.rows.length}
      />
    </Card>
  );
}

function noop(): void {}

function ExamScheduleSkeleton({
  label,
  showPicker = false,
}: {
  label: string;
  showPicker?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

function PortalExamSchedulePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
