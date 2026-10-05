/**
 * [34.5.1] Student detail — Programs tab. Clone of `-detail/results-panel.tsx`:
 * one card per enrolment (newest first), `<ProgressBar>` (hidden at 0
 * milestones per D6/D12) and `<MilestoneChecklist>` for ticking straight
 * from this page — the same components and `useStudentPrograms` cache
 * [34.4.1]'s Students tab already uses (D24: one shared query key family).
 * Empty state + Enrol CTA gated on `PROGRAM_MANAGE` (D12).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  MilestoneChecklist,
  ProgressBar,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '@biddaloy/ui/components';
import { useHasPermission, useRemoveAchievement, useStudentPrograms } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatDateRange, parseServerDate } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';

import { EnrolDialog } from '../../programs/-enrol-dialog';
import { RecordDialog } from '../../programs/-record-dialog';

const PROGRAM_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  COMPLETED: 'info',
  WITHDRAWN: 'neutral',
};

export interface ProgramsPanelProps {
  studentId: string;
}

export function ProgramsPanel({ studentId }: ProgramsPanelProps) {
  const { t } = useTranslation('programs');
  // Loads `students` so the `detail.programs.*` copy below resolves.
  useTranslation('students');
  const regionConfig = useRegionConfig();
  const programsQuery = useStudentPrograms(studentId);
  const canManage = useHasPermission(Permission.PROGRAM_MANAGE);
  const [enrolOpen, setEnrolOpen] = React.useState(false);
  const [recordFor, setRecordFor] = React.useState<{
    programId: string;
    enrollmentId: string;
    milestoneId?: string;
  } | null>(null);

  const removeAchievement = useRemoveAchievement();

  // MilestoneChecklist's own docstring: recording/undoing swaps the row's
  // checkbox for a new DOM node, dropping focus to <body> unless the
  // caller refocuses it — same fix as `-students-tab.tsx`'s
  // `refocusMilestone`.
  const milestonesContainerRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  function refocusMilestone(enrollmentId: string, milestoneId: string) {
    requestAnimationFrame(() => {
      milestonesContainerRefs.current[enrollmentId]
        ?.querySelector<HTMLElement>(`[data-milestone-id="${milestoneId}"][role="checkbox"]`)
        ?.focus();
    });
  }

  if (programsQuery.isPending) return <Skeleton className="h-24 w-full" />;
  if (programsQuery.isError) {
    return (
      <ErrorState
        message={t('studentProgramsPanel.loadError')}
        onRetry={() => void programsQuery.refetch()}
      />
    );
  }

  // Newest enrolment first.
  const entries = [...programsQuery.data].sort((a, b) =>
    b.enrollment.started_on.localeCompare(a.enrollment.started_on),
  );

  if (entries.length === 0) {
    return (
      <>
        <EmptyState
          title={t('studentProgramsPanel.empty')}
          explanation={t('detail.programs.emptyExplanation', { ns: 'students' })}
          {...(canManage
            ? { action: { label: t('students.enrol'), onClick: () => setEnrolOpen(true) } }
            : {})}
        />
        {enrolOpen && (
          <EnrolDialog
            open
            onOpenChange={setEnrolOpen}
            programId=""
            studentIdPrefill={studentId}
            onEnrolled={() => setEnrolOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() => setEnrolOpen(true)}
          >
            <PlusIcon className="size-4" aria-hidden />
            {t('students.enrol')}
          </Button>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <Card padded asChild key={entry.enrollment.id}>
            <li>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-h3">{entry.program.name}</h3>
                    <StatusBadge
                      tone={PROGRAM_TONE[entry.enrollment.status] ?? 'neutral'}
                      label={t(`status.${entry.enrollment.status}`)}
                    />
                  </div>
                  <p className="mt-0.5 text-text-secondary">
                    {entry.enrollment.ended_on
                      ? formatDateRange(
                          entry.enrollment.started_on,
                          entry.enrollment.ended_on,
                          regionConfig,
                        )
                      : t('detail.programs.since', {
                          ns: 'students',
                          date: formatDate(
                            parseServerDate(entry.enrollment.started_on),
                            regionConfig,
                          ),
                        })}
                  </p>
                </div>
                {entry.milestone_total > 0 && (
                  <ProgressBar
                    done={entry.achieved_count}
                    total={entry.milestone_total}
                    label={t('students.progress', {
                      done: entry.achieved_count,
                      total: entry.milestone_total,
                    })}
                  />
                )}
              </div>

              <div
                className="mt-2"
                ref={(el) => {
                  milestonesContainerRefs.current[entry.enrollment.id] = el;
                }}
              >
                <MilestoneChecklist
                  items={entry.milestones.map((m) => ({
                    id: m.id,
                    name: m.name,
                    achievedOn: m.achievement?.achieved_on ?? null,
                    scoreGrade: m.achievement
                      ? [m.achievement.score, m.achievement.grade]
                          .filter((value) => value !== null && value !== undefined)
                          .join(' / ') || null
                      : null,
                    remark: m.achievement?.remark ?? null,
                  }))}
                  undoLabel={t('milestones.remove')}
                  onRecord={(milestoneId) =>
                    setRecordFor({
                      programId: entry.program.id,
                      enrollmentId: entry.enrollment.id,
                      milestoneId,
                    })
                  }
                  onUndo={(milestoneId) => {
                    const achievementId = entry.milestones.find((m) => m.id === milestoneId)
                      ?.achievement?.id;
                    if (!achievementId) return;
                    removeAchievement.mutate(
                      {
                        achievementId,
                        programId: entry.program.id,
                        studentId,
                        milestoneId,
                      },
                      {
                        onSuccess: () => refocusMilestone(entry.enrollment.id, milestoneId),
                        onError: () => refocusMilestone(entry.enrollment.id, milestoneId),
                      },
                    );
                  }}
                />
              </div>
            </li>
          </Card>
        ))}
      </ul>

      {enrolOpen && (
        <EnrolDialog
          open
          onOpenChange={setEnrolOpen}
          programId=""
          studentIdPrefill={studentId}
          onEnrolled={() => setEnrolOpen(false)}
        />
      )}

      {recordFor && (
        <RecordDialog
          open
          onOpenChange={() => setRecordFor(null)}
          programId={recordFor.programId}
          milestoneId={recordFor.milestoneId}
          enrollmentIdPrefill={recordFor.enrollmentId}
          studentId={studentId}
          onRecorded={() => {
            if (recordFor.milestoneId) {
              refocusMilestone(recordFor.enrollmentId, recordFor.milestoneId);
            }
            setRecordFor(null);
          }}
        />
      )}
    </div>
  );
}
