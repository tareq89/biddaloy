/**
 * Students tab — [34.4.1], D8. Rows expand (a `<details>`-style button
 * with `aria-expanded`) to a `MilestoneChecklist` for that enrolment, fed
 * by `useStudentPrograms(student.id)` filtered down to this program — D24's
 * shared cache, so a record made here also updates the parent/student
 * portal. Progress column hidden entirely when `milestone_total === 0`
 * (D6/D12).
 */
import {
  EmptyState,
  MilestoneChecklist,
  ProgressBar,
  RowActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableCount,
} from '@biddaloy/ui/components';
import {
  useProgramEnrollments,
  useRecordAchievements,
  useRemoveAchievement,
  useStudentPrograms,
  useUpdateProgramEnrollment,
  type ProgramEnrollmentRow,
  type ProgramEnrollmentStatus,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { AwardIcon, ChevronDownIcon, ChevronRightIcon, UsersRoundIcon } from 'lucide-react';
import * as React from 'react';

import { LabelledField } from './-labelled-field';
import { RecordDialog } from './-record-dialog';

export interface StudentsTabProps {
  programId: string;
  milestoneTotal: number;
  /** [D5] Enrol/mark-complete/withdraw/reactivate require `PROGRAM_MANAGE`;
   * Record + the achievement checklist stay available to `PROGRAM_RECORD`
   * alone (e.g. a teacher). */
  canManage: boolean;
  onOpenEnrol: () => void;
}

export function StudentsTab({
  programId,
  milestoneTotal,
  canManage,
  onOpenEnrol,
}: StudentsTabProps) {
  const { t } = useTranslation('programs');
  const [status, setStatus] = React.useState<ProgramEnrollmentStatus>('ACTIVE');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [recordFor, setRecordFor] = React.useState<ProgramEnrollmentRow | null>(null);

  const enrollmentsQuery = useProgramEnrollments(programId, { status });
  const updateEnrollment = useUpdateProgramEnrollment();

  const enrollments = enrollmentsQuery.data ?? [];
  const showProgress = milestoneTotal > 0;

  return (
    <div className="flex flex-col gap-3">
      <LabelledField
        id="program-students-status"
        label={t('students.statusLabel')}
        className="md:w-56"
      >
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as ProgramEnrollmentStatus)}
        >
          <SelectTrigger id="program-students-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">{t('status.ACTIVE')}</SelectItem>
            <SelectItem value="COMPLETED">{t('status.COMPLETED')}</SelectItem>
            <SelectItem value="WITHDRAWN">{t('status.WITHDRAWN')}</SelectItem>
          </SelectContent>
        </Select>
      </LabelledField>

      {updateEnrollment.isError && (
        <p role="alert" className="text-destructive">
          {t('students.statusError')}
        </p>
      )}

      {enrollments.length === 0 && !enrollmentsQuery.isPending && (
        <EmptyState
          icon={<UsersRoundIcon />}
          title={t('studentTab.empty')}
          explanation={t('studentTab.emptyExplanation')}
          {...(canManage ? { action: { label: t('actions.enrol'), onClick: onOpenEnrol } } : {})}
        />
      )}

      {enrollments.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
          <ul className="divide-y divide-border-subtle" aria-label={t('studentTab.listLabel')}>
            {enrollments.map((row) => (
              <StudentRow
                key={row.id}
                programId={programId}
                row={row}
                status={status}
                showProgress={showProgress}
                canManage={canManage}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                onRecord={() => setRecordFor(row)}
                onStatusChange={(next) =>
                  updateEnrollment.mutate({
                    enrollmentId: row.id,
                    studentId: row.student.id,
                    input: { status: next },
                  })
                }
              />
            ))}
          </ul>
          <div className="border-t border-border-subtle px-4 py-3">
            <TableCount total={enrollments.length} />
          </div>
        </div>
      )}

      {recordFor && (
        <RecordDialog
          open
          onOpenChange={() => setRecordFor(null)}
          programId={programId}
          enrollmentIdPrefill={recordFor.id}
          studentId={recordFor.student.id}
          onRecorded={() => setRecordFor(null)}
        />
      )}
    </div>
  );
}

interface StudentRowProps {
  programId: string;
  row: ProgramEnrollmentRow;
  status: ProgramEnrollmentStatus;
  showProgress: boolean;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRecord: () => void;
  onStatusChange: (status: ProgramEnrollmentStatus) => void;
}

function StudentRow({
  programId,
  row,
  status,
  showProgress,
  canManage,
  expanded,
  onToggle,
  onRecord,
  onStatusChange,
}: StudentRowProps) {
  const { t } = useTranslation('programs');
  const regionConfig = useTenantRegionConfig();
  const studentProgramsQuery = useStudentPrograms(expanded ? row.student.id : undefined);
  const recordAchievements = useRecordAchievements();
  const removeAchievement = useRemoveAchievement();

  const entry = studentProgramsQuery.data?.find((e) => e.program.id === programId);
  const complete = row.milestone_total > 0 && row.achieved_count === row.milestone_total;

  // `MilestoneChecklist`'s own header comment documents this as the
  // caller's job: recording/undoing a milestone swaps the row's checkbox
  // for a brand-new DOM node (unticked plain `<button>` vs. ticked
  // `Popover`/`PopoverTrigger` button), so the browser drops focus to
  // `<body>` unless something re-finds and refocuses it (D9's keyboard
  // journey needs focus back on the same row after a tick).
  const milestonesContainerRef = React.useRef<HTMLDivElement | null>(null);
  function refocusMilestone(milestoneId: string) {
    requestAnimationFrame(() => {
      milestonesContainerRef.current
        ?.querySelector<HTMLElement>(`[data-milestone-id="${milestoneId}"][role="checkbox"]`)
        ?.focus();
    });
  }

  const roll = row.student.roll_number;
  const rollText = roll && /^\d+$/.test(roll) ? formatNumber(Number(roll), regionConfig) : roll;
  const name = row.student.full_name;

  return (
    <li>
      <div className="flex flex-col gap-2 px-2 py-2 md:flex-row md:items-center md:gap-4 md:px-4 md:py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start hover:bg-muted md:min-h-9"
        >
          {expanded ? (
            <ChevronDownIcon aria-hidden className="size-4 text-text-secondary" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-4 text-text-secondary" />
          )}
          <span className="truncate font-medium">{name}</span>
          {rollText && (
            <span className="shrink-0 text-text-secondary">
              {t('students.roll', { roll: rollText })}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 ps-8 md:contents">
          {showProgress && (
            <div className="min-w-0 flex-1 md:w-72 md:flex-none">
              <ProgressBar
                done={row.achieved_count}
                total={row.milestone_total}
                label={t('students.progress', {
                  done: formatNumber(row.achieved_count, regionConfig),
                  total: formatNumber(row.milestone_total, regionConfig),
                })}
              />
            </div>
          )}
          <RowActions
            actions={[
              {
                intent: 'edit',
                icon: <AwardIcon />,
                label: t('students.recordFor', { name }),
                onClick: onRecord,
              },
              ...(canManage
                ? status === 'ACTIVE'
                  ? [
                      {
                        intent: 'approve' as const,
                        label: complete ? t('students.completePrompt') : t('students.markComplete'),
                        onClick: () => onStatusChange('COMPLETED'),
                      },
                      {
                        intent: 'remove' as const,
                        label: t('students.withdraw'),
                        onClick: () => onStatusChange('WITHDRAWN'),
                      },
                    ]
                  : [
                      {
                        intent: 'restore' as const,
                        label: t('students.reactivate'),
                        onClick: () => onStatusChange('ACTIVE'),
                      },
                    ]
                : []),
            ]}
          />
        </div>
      </div>

      {expanded && entry && (
        <div
          className="border-t border-border-subtle bg-bg px-2 py-2 md:ps-12 md:pe-4"
          ref={milestonesContainerRef}
        >
          <MilestoneChecklist
            items={entry.milestones.map((m) => ({
              id: m.id,
              name: m.name,
              achievedOn: m.achievement
                ? formatDate(m.achievement.achieved_on, regionConfig)
                : null,
              scoreGrade: m.achievement
                ? [m.achievement.score, m.achievement.grade].filter(Boolean).join(' / ') || null
                : null,
              remark: m.achievement?.remark ?? null,
            }))}
            undoLabel={t('milestones.remove')}
            onRecord={(milestoneId) =>
              recordAchievements.mutate(
                {
                  programId,
                  studentId: row.student.id,
                  input: { enrollment_ids: [row.id], milestone_id: milestoneId },
                },
                {
                  onSuccess: () => refocusMilestone(milestoneId),
                  onError: () => refocusMilestone(milestoneId),
                },
              )
            }
            onUndo={(milestoneId) => {
              const achievementId = entry.milestones.find((m) => m.id === milestoneId)?.achievement
                ?.id;
              if (!achievementId) return;
              removeAchievement.mutate(
                {
                  achievementId,
                  programId,
                  studentId: row.student.id,
                  milestoneId,
                },
                {
                  onSuccess: () => refocusMilestone(milestoneId),
                  onError: () => refocusMilestone(milestoneId),
                },
              );
            }}
          />
        </div>
      )}
    </li>
  );
}
