import { SyllabusTopicStatus } from '@biddaloy/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
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
import {
  RegionConfigProvider,
  useLocale,
  useRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpenIcon } from 'lucide-react';
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
  component: PortalSyllabusRoute,
});

function PortalSyllabusRoute() {
  return (
    <RegionConfigProvider>
      <PortalSyllabus />
    </RegionConfigProvider>
  );
}

/** Same "class section · roll" line `attendance.tsx` and `portal/index.tsx` render. */
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
      <PageContainer size="narrow">
        <PageHeader title={t('syllabus.title')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={t('syllabus.title')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
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
        <EmptyState
          icon={<BookOpenIcon />}
          title={t('syllabus.noClassTitle')}
          explanation={t('syllabus.noClass')}
        />
      ) : (
        <SyllabusBody topicsQuery={topicsQuery} t={t} />
      )}
    </PageContainer>
  );
}

function SyllabusBody({
  topicsQuery,
  t,
}: {
  topicsQuery: ReturnType<typeof useSyllabusTopicList>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const { locale } = useLocale();
  const config = useRegionConfig();

  if (topicsQuery.isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('syllabus.loading')}</span>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
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
      <EmptyState
        icon={<BookOpenIcon />}
        title={t('syllabus.emptyTitle')}
        explanation={t('syllabus.empty')}
      />
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
        heading:
          (locale === 'bn'
            ? (topic.subject_name_bn ?? topic.subject_name_en)
            : (topic.subject_name_en ?? topic.subject_name_bn)) ?? t('syllabus.unknownSubject'),
        topics: [topic],
      });
    }
  }
  const subjects = Array.from(bySubject.values()).sort((a, b) =>
    a.heading.localeCompare(b.heading),
  );

  return (
    <div className="space-y-6">
      {subjects.map((subject) => {
        const done = subject.topics.filter(
          (topic) => topic.status === SyllabusTopicStatus.DONE,
        ).length;
        const titleId = `subject-${subject.subjectId}`;
        return (
          <Card key={subject.subjectId} asChild padded>
            <article aria-labelledby={titleId}>
              <h2 id={titleId} className="text-h2">
                {subject.heading}
              </h2>
              <div className="mt-3">
                <ProgressBar
                  done={done}
                  total={subject.topics.length}
                  label={t('syllabus.progressLabel', {
                    done: formatNumber(done, config),
                    total: formatNumber(subject.topics.length, config),
                  })}
                />
              </div>
              <ol className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
                {subject.topics.map((topic, index) => (
                  <li key={topic.id} className="flex min-h-11 items-start gap-3 py-2.5">
                    {/* Numbered 1…n inside the subject (`sequence` can have gaps); the
                        `<ol>` already numbers for a screen reader. */}
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-text-secondary"
                    >
                      {formatNumber(index + 1, config)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{topic.name}</p>
                      {topic.description && (
                        <p className="text-caption text-text-secondary">{topic.description}</p>
                      )}
                    </div>
                    <span className="shrink-0">
                      <StatusBadge domain="syllabusTopic" status={topic.status} />
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          </Card>
        );
      })}
    </div>
  );
}

function SyllabusSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

function PortalSyllabusPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
