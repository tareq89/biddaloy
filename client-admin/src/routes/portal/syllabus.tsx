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
  useStudentStudyPlans,
  useSyllabusTopicList,
  type FamilyStudyPlansResponse,
  type Student,
  type SyllabusTopic,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpenIcon, ChevronDownIcon, FlagIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

import { StudyPlanSubject, type FamilySubjectPlan } from './-study-plan-subject';

/**
 * [22.4.5] The portal's read-only syllabus tab. [66.3] It now shows where the
 * class is per subject (the family study-plan endpoint), with today's topic
 * list kept for any subject that has no plan so nothing a family saw before
 * disappears. Cloned from `portal/attendance.tsx`'s structure (loader, search
 * schema, child selection).
 *
 * The server's `GET /syllabus-topics` accepts an optional `class_id`, but
 * has no per-student scoping — a call without it returns the whole
 * tenant's topics. So the topics query only ever fires once a class id is
 * known (`enabled: classId !== undefined`).
 *
 * Only family endpoints are called: `GET /students/:id/study-plans` checks
 * the guardian link server-side; staff endpoints 403 for a family.
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
  // Enabled only once the child id is known; a child with no class has no plans.
  const plansQuery = useStudentStudyPlans(classId === undefined ? undefined : selected?.id);

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

  const term = plansQuery.data?.term;
  return (
    <PageContainer size="narrow">
      <PageHeader
        title={t('syllabus.title')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}${term ? ` · ${term.name}` : ''}`}
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
        <SyllabusBody key={selected.id} topicsQuery={topicsQuery} plansQuery={plansQuery} />
      )}
    </PageContainer>
  );
}

type SubjectRef = FamilyStudyPlansResponse['subjects_without_plan'][number];

function SyllabusBody({
  topicsQuery,
  plansQuery,
}: {
  topicsQuery: ReturnType<typeof useSyllabusTopicList>;
  plansQuery: ReturnType<typeof useStudentStudyPlans>;
}) {
  const { t } = useTranslation('portal');
  const { locale } = useLocale();
  const subjectName = React.useCallback(
    (ref: Pick<SubjectRef, 'name_en' | 'name_bn'>) =>
      (locale === 'bn' ? (ref.name_bn ?? ref.name_en) : (ref.name_en ?? ref.name_bn)) ??
      t('syllabus.unknownSubject'),
    [locale, t],
  );

  if (topicsQuery.isPending || plansQuery.isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('syllabus.loading')}</span>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  // One source of truth for "where the class is": no half page.
  if (topicsQuery.isError || plansQuery.isError) {
    return (
      <ErrorState
        message={t('syllabus.error.message')}
        retryLabel={t('syllabus.error.retry')}
        onRetry={() => {
          void topicsQuery.refetch();
          void plansQuery.refetch();
        }}
      />
    );
  }

  const plans = plansQuery.data;
  const topics = topicsQuery.data;

  // Plan subjects, most behind first (stable for ties).
  const planned = plans.subjects
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => b.plan.lessons_behind - a.plan.lessons_behind || a.index - b.index)
    .map(({ plan }) => plan);

  // Topic lists for subjects with no plan: the server's list, plus any subject
  // that only appears in the topic list (so no topic a family saw is dropped).
  const plannedIds = new Set(planned.map((plan) => plan.subject.id));
  const topicsBySubject = new Map<string, SyllabusTopic[]>();
  for (const topic of topics) {
    if (plannedIds.has(topic.subject_id)) continue;
    topicsBySubject.set(topic.subject_id, [
      ...(topicsBySubject.get(topic.subject_id) ?? []),
      topic,
    ]);
  }
  const unplanned = new Map<string, { id: string; heading: string; topics: SyllabusTopic[] }>();
  for (const ref of plans.subjects_without_plan) {
    if (plannedIds.has(ref.id)) continue;
    unplanned.set(ref.id, {
      id: ref.id,
      heading: subjectName(ref),
      topics: topicsBySubject.get(ref.id) ?? [],
    });
  }
  for (const [id, list] of topicsBySubject) {
    if (unplanned.has(id)) continue;
    unplanned.set(id, {
      id,
      heading: subjectName({
        name_en: list[0]!.subject_name_en,
        name_bn: list[0]!.subject_name_bn,
      }),
      topics: list,
    });
  }
  const unplannedList = Array.from(unplanned.values()).sort((a, b) =>
    a.heading.localeCompare(b.heading),
  );

  if (planned.length === 0 && unplannedList.length === 0) {
    return (
      <EmptyState
        icon={<BookOpenIcon />}
        title={t('syllabus.emptyTitle')}
        explanation={t('syllabus.empty')}
      />
    );
  }

  const [first, ...others] = planned;
  const rows = [
    ...others.map((plan) => ({
      key: plan.plan_id,
      node: <PlanDisclosure plan={plan} heading={subjectName(plan.subject)} defaultOpen={false} />,
    })),
    ...unplannedList.map((item) => ({
      key: item.id,
      node: <NoPlanRow heading={item.heading} id={item.id} topics={item.topics} />,
    })),
  ];

  return (
    <div className="space-y-6">
      <ExamCard planned={planned} subjectName={subjectName} />
      {first && (
        <Card padded>
          <PlanDisclosure plan={first} heading={subjectName(first.subject)} defaultOpen />
        </Card>
      )}
      {rows.length > 0 && (
        <Card padded>
          {first && <h2 className="mb-1 text-h3">{t('syllabus.plan.otherSubjects')}</h2>}
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <li key={row.key}>{row.node}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** A real button over its region: Tab reaches it, Enter/Space toggles. */
function Disclosure({
  id,
  heading,
  badge,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  heading: string;
  badge: React.ReactNode;
  summary: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const regionId = `region-${id}`;
  return (
    <div>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-start gap-3 py-2.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-h2">{heading}</span>
              {badge}
            </span>
            {summary && <span className="block text-text-secondary">{summary}</span>}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={`mt-1 size-5 shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div id={regionId} role="region" aria-label={heading} hidden={!open} className="pb-3">
        {open && children}
      </div>
    </div>
  );
}

function PlanDisclosure({
  plan,
  heading,
  defaultOpen,
}: {
  plan: FamilySubjectPlan;
  heading: string;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const behind = plan.lessons_behind >= 1;
  return (
    <Disclosure
      id={plan.plan_id}
      heading={heading}
      defaultOpen={defaultOpen}
      badge={
        behind ? (
          <StatusBadge
            tone="warning"
            label={t('syllabus.plan.behind', {
              count: plan.lessons_behind,
            })}
          />
        ) : (
          <StatusBadge tone="success" label={t('syllabus.plan.onTime')} />
        )
      }
      summary={
        plan.last_taught
          ? t('syllabus.plan.now', {
              no: formatNumber(plan.last_taught.number, config),
              title: plan.last_taught.title,
            })
          : t('syllabus.plan.notStarted')
      }
    >
      <StudyPlanSubject plan={plan} />
    </Disclosure>
  );
}

/** Today's topic list for a subject that has no study plan. */
function NoPlanRow({
  id,
  heading,
  topics,
}: {
  id: string;
  heading: string;
  topics: SyllabusTopic[];
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const done = topics.filter((topic) => topic.status === SyllabusTopicStatus.DONE).length;
  return (
    <Disclosure
      id={id}
      heading={heading}
      badge={<StatusBadge tone="neutral" label={t('syllabus.plan.noPlan')} />}
      summary={
        topics.length > 0
          ? t('syllabus.plan.topicsOnly', {
              done: formatNumber(done, config),
              total: formatNumber(topics.length, config),
            })
          : null
      }
    >
      {topics.length === 0 ? (
        <p className="text-text-secondary">{t('syllabus.empty')}</p>
      ) : (
        <>
          <ProgressBar
            done={done}
            total={topics.length}
            label={t('syllabus.progressLabel', {
              done: formatNumber(done, config),
              total: formatNumber(topics.length, config),
            })}
          />
          <ol className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
            {topics.map((topic, index) => (
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
        </>
      )}
    </Disclosure>
  );
}

/** D21: the soonest exam that is today or later (no date = upcoming, last). */
function ExamCard({
  planned,
  subjectName,
}: {
  planned: FamilySubjectPlan[];
  subjectName: (ref: Pick<SubjectRef, 'name_en' | 'name_bn'>) => string;
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const today = toIsoDate(new Date());

  const exams = new Map<string, { name: string; date: string | null }>();
  for (const plan of planned) {
    for (const exam of plan.exam_syllabus) {
      if (exam.exam_date !== null && exam.exam_date < today) continue;
      exams.set(exam.exam_id, { name: exam.exam_name, date: exam.exam_date });
    }
  }
  const soonest = Array.from(exams.entries()).sort(([, a], [, b]) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  })[0];
  if (!soonest) return null;

  const [examId, exam] = soonest;
  const rows = planned.flatMap((plan) => {
    const entry = plan.exam_syllabus.find((e) => e.exam_id === examId);
    return entry ? [{ plan, entry }] : [];
  });

  return (
    <Card padded asChild>
      <section aria-labelledby="exam-card-title">
        <div className="flex items-start gap-3">
          <FlagIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-text-secondary" />
          <div>
            <h2 id="exam-card-title" className="text-h2">
              {t('syllabus.plan.examTitle', { exam: exam.name })}
            </h2>
            <p className="text-text-secondary">
              {exam.date
                ? t('syllabus.plan.examMeta', { date: formatDate(exam.date, config) })
                : t('syllabus.plan.examMetaNoDate')}
            </p>
          </div>
        </div>
        <ul className="mt-3 space-y-3">
          {rows.map(({ plan, entry }) => (
            <li key={plan.plan_id}>
              <p className="font-medium">{subjectName(plan.subject)}</p>
              <ProgressBar
                done={entry.lessons_taught}
                total={entry.lessons_in_syllabus}
                label={t('syllabus.plan.lessonsOf', {
                  done: formatNumber(entry.lessons_taught, config),
                  total: formatNumber(entry.lessons_in_syllabus, config),
                })}
              />
            </li>
          ))}
        </ul>
      </section>
    </Card>
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
