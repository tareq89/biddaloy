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
 */
import {
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentExamSchedule,
  type Student,
  type StudentExamScheduleRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
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
  component: PortalExamSchedule,
});

function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll: student.roll_number,
        });
  };
}

function PortalExamSchedule() {
  const { t } = useTranslation('portal');
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
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
      />
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

  // Upcoming-first — the API already sorts this way, but a defensive
  // client-side sort keeps this page correct even if a caching layer
  // ever reorders the response.
  const rows = scheduleQuery.data
    .slice()
    .sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.starts_at.localeCompare(b.starts_at),
    );

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">{t('examSchedule.title')}</h1>
        <p className="text-xs text-muted-foreground">
          {`${selected.full_name} · ${studentMeta(selected)}`}
        </p>
      </div>
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

      {rows.length === 0 ? (
        <p className="p-3.5 text-sm text-muted-foreground">{t('examSchedule.empty')}</p>
      ) : (
        <Card className="flex flex-col">
          {rows.map((row, index) => (
            <ScheduleRow key={row.id} row={row} bordered={index > 0} />
          ))}
        </Card>
      )}
    </div>
  );
}

function ScheduleRow({ row, bordered }: { row: StudentExamScheduleRow; bordered: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-sm ${bordered ? 'border-t border-border-subtle' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{row.subject?.name_en ?? row.subject_id}</span>
        <span className="ms-1.5 text-xs text-muted-foreground">{row.exam.name}</span>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <div>
          {row.date} · {row.starts_at}–{row.ends_at}
        </div>
        {row.venue && <div>{row.venue}</div>}
      </div>
    </div>
  );
}

function ExamScheduleSkeleton({
  label,
  showPicker = false,
}: {
  label: string;
  showPicker?: boolean;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-7 w-2/5" />
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
