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
  /** [31.5.0] Enrol / record full pages live in the URL (`?enrolProgram=1`,
   * `?recordMilestone=<enrollmentId>`); the route owns the keys. */
  enrolOpen?: boolean;
  onEnrolOpenChange?: (open: boolean) => void;
  recordEnrollmentId?: string | undefined;
  onRecordChange?: (enrollmentId: string | undefined) => void;
}

export function ProgramsPanel({
  studentId,
  enrolOpen = false,
  onEnrolOpenChange = () => {},
  recordEnrollmentId,
  onRecordChange = () => {},
}: ProgramsPanelProps) {
  const { t } = useTranslation('programs');
  // Explicit second binding: also makes sure `students` is loaded for the copy below.
  const { t: tStudents } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const programsQuery = useStudentPrograms(studentId);
  const canManage = useHasPermission(Permission.PROGRAM_MANAGE);
  // The milestone the user clicked is not URL-reflected (a refresh reopens
  // the record page for the enrolment without a milestone prefilled).
  const [recordMilestoneId, setRecordMilestoneId] = React.useState<string | undefined>();

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

  const recordFor = entries.find((e) => e.enrollment.id === recordEnrollmentId);

  if (entries.length === 0) {
    return (
      <>
        <EmptyState
          title={t('studentProgramsPanel.empty')}
          explanation={tStudents('detail.programs.emptyExplanation')}
          {...(canManage
            ? { action: { label: t('students.enrol'), onClick: () => onEnrolOpenChange(true) } }
            : {})}
        />
        {enrolOpen && (
          <EnrolDialog
            open
            onOpenChange={onEnrolOpenChange}
            programId=""
            studentIdPrefill={studentId}
            onEnrolled={() => onEnrolOpenChange(false)}
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
            onClick={() => onEnrolOpenChange(true)}
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
                      : tStudents('detail.programs.since', {
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
                  onRecord={(milestoneId) => {
                    setRecordMilestoneId(milestoneId);
                    onRecordChange(entry.enrollment.id);
                  }}
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
          onOpenChange={onEnrolOpenChange}
          programId=""
          studentIdPrefill={studentId}
          onEnrolled={() => onEnrolOpenChange(false)}
        />
      )}

      {recordFor && (
        <RecordDialog
          open
          onOpenChange={() => onRecordChange(undefined)}
          programId={recordFor.program.id}
          milestoneId={recordMilestoneId}
          enrollmentIdPrefill={recordFor.enrollment.id}
          studentId={studentId}
          onRecorded={() => {
            if (recordMilestoneId) refocusMilestone(recordFor.enrollment.id, recordMilestoneId);
            onRecordChange(undefined);
          }}
        />
      )}
    </div>
  );
}
