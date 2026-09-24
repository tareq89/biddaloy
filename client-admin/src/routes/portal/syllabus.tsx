import {
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useSyllabusTopicList,
  type Student,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

/**
 * [22.4.5] The portal's read-only syllabus tab: for the selected child's
 * class, every topic grouped by subject, in `sequence` order. Cloned from
 * `portal/attendance.tsx`'s structure (loader, search schema, child
 * selection), minus the month/grid — this route has no date dimension.
 *
 * The server's `GET /syllabus-topics` accepts an optional `class_id`, but
 * has no per-student scoping — a call without it returns the whole
 * tenant's topics. So the topics query only ever fires once a class id is
 * known (`enabled: classId !== undefined`).
 */
const searchSchema = z.object({
  student: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/syllabus')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common'),
    ]),
  pendingComponent: PortalSyllabusPending,
  component: PortalSyllabus,
});

/** Same "class section · roll" line `attendance.tsx` and `portal/index.tsx` render. */
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

function PortalSyllabus() {
  const { t } = useTranslation('portal');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const classId = selected?.class_section?.class_id ?? undefined;
  const topicsQuery = useSyllabusTopicList(classId === undefined ? {} : { class_id: classId }, {
    enabled: classId !== undefined,
  });

  if (studentsQuery.isPending) return <SyllabusSkeleton label={t('syllabus.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('syllabus.error.message')}
        retryLabel={t('syllabus.error.retry')}
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

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{t('syllabus.title')}</h1>
      {students.length > 1 && (
        <StudentPicker
          label={t('syllabus.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/syllabus"
        />
      )}
      {classId === undefined ? (
        <Card className="p-3.5">
          <p className="text-sm text-muted-foreground">{t('syllabus.noClass')}</p>
        </Card>
      ) : (
        <SyllabusBody topicsQuery={topicsQuery} t={t} />
      )}
    </div>
  );
}

function SyllabusBody({
  topicsQuery,
  t,
}: {
  topicsQuery: ReturnType<typeof useSyllabusTopicList>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (topicsQuery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('syllabus.loading')}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (topicsQuery.isError) {
    return (
      <ErrorState
        message={t('syllabus.error.message')}
        retryLabel={t('syllabus.error.retry')}
        onRetry={() => void topicsQuery.refetch()}
      />
    );
  }

  const topics = topicsQuery.data;

  if (topics.length === 0) {
    return (
      <Card className="p-3.5">
        <p className="text-sm text-muted-foreground">{t('syllabus.empty')}</p>
      </Card>
    );
  }

  // Bucket in server order (already `sequence ASC`), then sort headings.
  const bySubject = new Map<
    string,
    { subjectId: string; heading: string; topics: typeof topics }
  >();
  for (const topic of topics) {
    const existing = bySubject.get(topic.subject_id);
    if (existing) {
      existing.topics.push(topic);
    } else {
      bySubject.set(topic.subject_id, {
        subjectId: topic.subject_id,
        heading: topic.subject_name_en ?? t('syllabus.unknownSubject'),
        topics: [topic],
      });
    }
  }
  const subjects = Array.from(bySubject.values()).sort((a, b) =>
    a.heading.localeCompare(b.heading),
  );

  return (
    <>
      {subjects.map((subject) => (
        <Card key={subject.subjectId} className="flex flex-col gap-2 p-3.5">
          <h2 className="text-sm font-semibold">{subject.heading}</h2>
          <ol className="flex flex-col gap-2">
            {subject.topics.map((topic) => (
              <li key={topic.id} className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{topic.name}</span>
                  {topic.description && (
                    <span className="text-xs text-muted-foreground">{topic.description}</span>
                  )}
                </div>
                <StatusBadge domain="syllabusTopic" status={topic.status} />
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </>
  );
}

function SyllabusSkeleton({ label }: { label: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

function PortalSyllabusPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
