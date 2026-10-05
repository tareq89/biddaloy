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
 *
 * Layout: one card per enrolment — name and status badge, a progress
 * sentence, and a short milestone list (the last three achieved plus the
 * next one when a program has more than four) with a toggle for the full
 * list. Region config comes from a value-less `RegionConfigProvider`
 * (same reasoning as `fees.tsx`).
 */
import {
  Button,
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
  useStudentPrograms,
  type Student,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleIcon,
  MilestoneIcon,
} from 'lucide-react';
import * as React from 'react';
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
  component: PortalProgramsRoute,
});

function PortalProgramsRoute() {
  return (
    <RegionConfigProvider>
      <PortalPrograms />
    </RegionConfigProvider>
  );
}

/** Same "class section · roll" line `portal/results.tsx`'s own
 * `useStudentMeta` renders, from the same two keys. */
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

function PortalPrograms() {
  const { t } = useTranslation('portal');
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
      <PageContainer size="narrow">
        <PageHeader title={t('programs.title')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
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
    <PageContainer size="narrow">
      <PageHeader
        title={t('programs.title')}
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
          to="/portal/programs"
        />
      )}

      {programsQuery.data.length === 0 ? (
        <EmptyState
          icon={<MilestoneIcon />}
          title={t('programs.emptyTitle')}
          explanation={t('programs.emptyExplanation')}
        />
      ) : (
        <div className="space-y-6">
          {programsQuery.data.map((entry) => (
            <ProgramCard key={entry.enrollment.id} entry={entry} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

interface ProgramEntry {
  program: { id: string; name: string };
  enrollment: { id: string; status: string };
  milestones: ProgramMilestone[];
  achieved_count: number;
  milestone_total: number;
}

interface ProgramMilestone {
  id: string;
  name: string;
  achievement: { achieved_on: string; score: string | null; grade: string | null } | null;
}

const STATUS_TONE = { ACTIVE: 'info', COMPLETED: 'success', WITHDRAWN: 'neutral' } as const;

/** Which milestone rows to show. A long program (more than four) shows only
 * the last three achieved plus the next one until expanded — the bar answers
 * "how far", the next row answers "what's next". */
export function visibleMilestones(
  milestones: ProgramMilestone[],
  expanded: boolean,
): ProgramMilestone[] {
  if (expanded || milestones.length <= 4) return milestones;
  const keep = new Set<number>();
  const achieved = milestones.flatMap((m, i) => (m.achievement !== null ? [i] : []));
  achieved.slice(-3).forEach((i) => keep.add(i));
  const nextIndex = milestones.findIndex((m) => m.achievement === null);
  if (nextIndex >= 0) keep.add(nextIndex);
  return milestones.filter((_, i) => keep.has(i));
}

function ProgramCard({ entry }: { entry: ProgramEntry }) {
  const { t } = useTranslation('portal');
  const { t: tPrograms } = useTranslation('programs');
  const config = useRegionConfig();
  const [expanded, setExpanded] = React.useState(false);
  const titleId = `program-${entry.enrollment.id}`;
  // Never the raw enum: an unknown status simply shows no badge.
  const statusLabel = tPrograms(`status.${entry.enrollment.status}`, { defaultValue: '' });
  const tone = STATUS_TONE[entry.enrollment.status as keyof typeof STATUS_TONE] ?? 'neutral';
  const nextId = entry.milestones.find((m) => m.achievement === null)?.id;
  const rows = visibleMilestones(entry.milestones, expanded);

  return (
    <Card asChild>
      <article className="p-4 md:p-5" aria-labelledby={titleId}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={titleId} className="text-h2">
            {entry.program.name}
          </h2>
          {statusLabel && <StatusBadge tone={tone} label={statusLabel} />}
        </div>
        {entry.milestone_total > 0 && (
          <div className="mt-3">
            <ProgressBar
              done={entry.achieved_count}
              total={entry.milestone_total}
              label={t('programs.progressLabel', {
                done: formatNumber(entry.achieved_count, config),
                total: formatNumber(entry.milestone_total, config),
              })}
            />
          </div>
        )}
        {/* Static rows, not `MilestoneChecklist` — see this file's header
         * comment: that component is another lane's shared territory this
         * wave and offers no read-only mode. */}
        <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              milestone={milestone}
              isNext={milestone.id === nextId}
              config={config}
            />
          ))}
        </ul>
        {entry.milestones.length > 4 && (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 h-11 w-full md:h-8 md:w-auto"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUpIcon aria-hidden="true" />
            ) : (
              <ChevronDownIcon aria-hidden="true" />
            )}
            {expanded
              ? t('programs.showFewer')
              : t('programs.showAll', { count: entry.milestones.length })}
          </Button>
        )}
      </article>
    </Card>
  );
}

function MilestoneRow({
  milestone,
  isNext,
  config,
}: {
  milestone: ProgramMilestone;
  isNext: boolean;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  const achievement = milestone.achievement;
  const score =
    achievement?.score != null && Number.isFinite(Number(achievement.score))
      ? formatNumber(Number(achievement.score), config)
      : achievement?.score;
  const scoreGrade = [score, achievement?.grade].filter(Boolean).join(' / ');

  return (
    <li className="flex min-h-11 items-center gap-3 py-2">
      {achievement !== null ? (
        <CircleCheckIcon
          className="size-5 shrink-0 text-status-paid-fg"
          role="img"
          aria-label={t('programs.achieved')}
        />
      ) : (
        <CircleIcon
          className="size-5 shrink-0 text-text-secondary"
          role="img"
          aria-label={t('programs.notYet')}
        />
      )}
      <span className={`min-w-0 flex-1 ${isNext ? 'font-medium' : ''}`}>{milestone.name}</span>
      {achievement !== null ? (
        <span className="shrink-0 text-end text-caption text-text-secondary">
          {formatDate(achievement.achieved_on, config)}
          {scoreGrade ? ` · ${scoreGrade}` : ''}
        </span>
      ) : isNext ? (
        <StatusBadge tone="neutral" label={t('programs.next')} />
      ) : null}
    </li>
  );
}

function ProgramsSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

function PortalProgramsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
