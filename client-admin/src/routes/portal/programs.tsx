/**
 * [34.5.2] — the guardian/student portal's read-only view of a child's
 * programs. Cloned from `portal/results.tsx`'s shell (issue step 1): same
 * `?student=` picker wiring, same `useMyStudents`/`swallowUnlessOffline`
 * loader shape, same "no `<h1>` while pending/erroring" contract.
 *
 * **Read-only (D24).** `GET /students/:studentId/programs` is the same
 * endpoint the staff Students tab (`-students-tab.tsx`) reads — D24's
 * shared cache — but this page never records or removes an achievement,
 * so it renders a plain static tick list instead of the shared
 * `MilestoneChecklist` component: that component's only public shape is
 * interactive (`onRecord`/`onUndo` are required props, no `readOnly`
 * escape hatch), and `ui/src/components/programs/**` is another lane's
 * territory this wave. No print button (unlike `results.tsx` — nothing
 * here is a document to hand a guardian).
 */
import {
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  RoutePending,
  Skeleton,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentPrograms,
  type Student,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

const programsSearchSchema = z.object({
  /** Same contract as `portal/results.tsx`'s own `student` param — not
   * trusted to widen anything, the server re-checks the link on every
   * request. */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/programs')({
  validateSearch: programsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'programs'),
    ]),
  pendingComponent: PortalProgramsPending,
  component: PortalPrograms,
});

/** Same "class section · roll" line `portal/results.tsx`'s own
 * `useStudentMeta` renders, from the same two keys. */
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

function PortalPrograms() {
  const { t } = useTranslation('portal');
  const { t: tPrograms } = useTranslation('programs');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const programsQuery = useStudentPrograms(selected?.id);

  if (studentsQuery.isPending) return <ProgramsSkeleton label={t('programs.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('programs.error.message')}
        retryLabel={t('programs.error.retry')}
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

  if (programsQuery.isPending) {
    return <ProgramsSkeleton label={t('programs.loading')} showPicker={students.length > 1} />;
  }

  if (programsQuery.isError) {
    return (
      <ErrorState
        message={t('programs.error.message')}
        retryLabel={t('programs.error.retry')}
        onRetry={() => void programsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">{t('programs.title')}</h1>
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
          to="/portal/programs"
        />
      )}

      {programsQuery.data.length === 0 ? (
        <p className="p-3.5 text-sm text-muted-foreground">{t('programs.empty')}</p>
      ) : (
        <Card className="flex flex-col">
          {programsQuery.data.map((entry, index) => (
            <ProgramCard
              key={entry.program.id}
              entry={entry}
              bordered={index > 0}
              statusLabel={tPrograms(`status.${entry.enrollment.status}`)}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

interface ProgramEntry {
  program: { id: string; name: string };
  enrollment: { status: string };
  milestones: {
    id: string;
    name: string;
    achievement: { achieved_on: string; score: string | null; grade: string | null } | null;
  }[];
  achieved_count: number;
  milestone_total: number;
}

function ProgramCard({
  entry,
  bordered,
  statusLabel,
}: {
  entry: ProgramEntry;
  bordered: boolean;
  statusLabel: string;
}) {
  const { t: tPrograms } = useTranslation('programs');

  return (
    <div
      className={
        bordered
          ? 'flex flex-col gap-2 border-t border-border-subtle p-3.5'
          : 'flex flex-col gap-2 p-3.5'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{entry.program.name}</span>
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
      </div>
      {entry.milestone_total > 0 && (
        <ProgressBar
          done={entry.achieved_count}
          total={entry.milestone_total}
          label={tPrograms('students.progress', {
            done: entry.achieved_count,
            total: entry.milestone_total,
          })}
        />
      )}
      {/* Static ticks, not `MilestoneChecklist` — see this file's header
       * comment: that component is another lane's shared territory this
       * wave and offers no read-only mode. */}
      <ul className="flex flex-col gap-1">
        {entry.milestones.map((milestone) => (
          <li key={milestone.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true">{milestone.achievement !== null ? '☑' : '☐'}</span>
            <span className="flex-1">{milestone.name}</span>
            {milestone.achievement !== null && (
              <span className="text-xs text-muted-foreground">
                {milestone.achievement.achieved_on}
                {milestone.achievement.score || milestone.achievement.grade
                  ? ` · ${[milestone.achievement.score, milestone.achievement.grade].filter(Boolean).join(' / ')}`
                  : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgramsSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
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

function PortalProgramsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
