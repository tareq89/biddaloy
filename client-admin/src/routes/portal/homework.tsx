import {
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StudentPicker,
} from '@biddaloy/ui/components';
import { myStudentsQueryOptions, useMyStudents, type Student } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { NotebookPenIcon } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

import { useFamilyHomework, type FamilyHomeworkList } from './-use-family-homework';

/**
 * [8.10.7.5.10] The portal's read-only homework list: the selected child's
 * homework due today and later (`GET /students/:id/homework`, which checks the
 * guardian link server-side). Cloned from `portal/syllabus.tsx`. "Today" and
 * "tomorrow" come from the response's `today`, never the browser clock.
 */
const searchSchema = z.object({
  student: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/homework')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common'),
    ]),
  pendingComponent: PortalHomeworkPending,
  component: PortalHomeworkRoute,
});

function PortalHomeworkRoute() {
  return (
    <RegionConfigProvider>
      <PortalHomework />
    </RegionConfigProvider>
  );
}

/** Same "class section · roll" line `syllabus.tsx` renders. */
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

function PortalHomework() {
  const { t } = useTranslation('portal');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];
  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;
  const homeworkQuery = useFamilyHomework(selected?.id);

  if (studentsQuery.isPending) return <HomeworkSkeleton label={t('homework.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('homework.error')}
        retryLabel={t('syllabus.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer size="narrow">
        <PageHeader title={t('homework.title')} />
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
        title={t('homework.title')}
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
          to="/portal/homework"
        />
      )}
      {homeworkQuery.isPending ? (
        <div className="space-y-6" aria-busy="true" aria-live="polite">
          <span className="sr-only">{t('homework.loading')}</span>
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : homeworkQuery.isError ? (
        <ErrorState
          message={t('homework.error')}
          retryLabel={t('syllabus.error.retry')}
          onRetry={() => void homeworkQuery.refetch()}
        />
      ) : homeworkQuery.data.items.length === 0 ? (
        <EmptyState
          icon={<NotebookPenIcon />}
          title={t('homework.emptyTitle')}
          explanation={t('homework.emptyBody')}
        />
      ) : (
        <HomeworkList data={homeworkQuery.data} />
      )}
    </PageContainer>
  );
}

/** The day after an ISO date, as an ISO date (noon local, so DST cannot shift the day). */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

function HomeworkList({ data }: { data: FamilyHomeworkList }) {
  const { t } = useTranslation('portal');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const tomorrow = nextDay(data.today);

  const dueLabel = (due: string) =>
    due === data.today
      ? t('homeworkCard.dueToday')
      : due === tomorrow
        ? t('homeworkCard.dueTomorrow')
        : t('homeworkCard.dueOn', { date: formatDate(due, config) });

  // One group per due date, soonest first.
  const groups = new Map<string, FamilyHomeworkList['items']>();
  for (const item of [...data.items].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    groups.set(item.due_date, [...(groups.get(item.due_date) ?? []), item]);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups, ([due, items]) => (
        <Card key={due} padded asChild>
          <section aria-labelledby={`due-${due}`}>
            <h2 id={`due-${due}`} className="text-h2">
              {dueLabel(due)}
            </h2>
            <ul className="divide-y divide-border-subtle">
              {items.map((item) => (
                <li key={item.assignment_id} className="min-h-11 py-2.5">
                  <p className="text-caption text-text-secondary">
                    {(locale === 'bn'
                      ? (item.subject_name_bn ?? item.subject_name_en)
                      : item.subject_name_en) || t('syllabus.unknownSubject')}
                  </p>
                  <p className="font-medium">{item.title}</p>
                  {item.description && <p className="text-text-secondary">{item.description}</p>}
                  <p className="text-caption text-text-secondary">
                    {t('homework.colAssigned')}: {formatDate(item.assigned_date, config)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </Card>
      ))}
    </div>
  );
}

function HomeworkSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

function PortalHomeworkPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
