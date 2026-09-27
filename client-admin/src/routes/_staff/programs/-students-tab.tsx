/**
 * Students tab — [34.4.1], D8. Rows expand (a `<details>`-style button
 * with `aria-expanded`) to a `MilestoneChecklist` for that enrolment, fed
 * by `useStudentPrograms(student.id)` filtered down to this program — D24's
 * shared cache, so a record made here also updates the parent/student
 * portal. Progress column hidden entirely when `milestone_total === 0`
 * (D6/D12).
 */
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  MilestoneChecklist,
  ProgressBar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

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
  const [toolbarRecordOpen, setToolbarRecordOpen] = React.useState(false);

  const enrollmentsQuery = useProgramEnrollments(programId, { status });
  const updateEnrollment = useUpdateProgramEnrollment();

  const enrollments = enrollmentsQuery.data ?? [];
  const showProgress = milestoneTotal > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as ProgramEnrollmentStatus)}
        >
          <SelectTrigger aria-label={t('students.enrol')} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">{t('status.ACTIVE')}</SelectItem>
            <SelectItem value="COMPLETED">{t('status.COMPLETED')}</SelectItem>
            <SelectItem value="WITHDRAWN">{t('status.WITHDRAWN')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setToolbarRecordOpen(true)}>
            {t('students.record')}
          </Button>
          {canManage && (
            <Button type="button" onClick={onOpenEnrol}>
              {t('students.enrol')}
            </Button>
          )}
        </div>
      </div>

      {enrollments.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('studentTab.empty')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {enrollments.map((row) => (
          <StudentRow
            key={row.id}
            programId={programId}
            row={row}
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

      {toolbarRecordOpen && (
        <RecordDialog
          open
          onOpenChange={() => setToolbarRecordOpen(false)}
          programId={programId}
          onRecorded={() => setToolbarRecordOpen(false)}
        />
      )}
    </div>
  );
}

interface StudentRowProps {
  programId: string;
  row: ProgramEnrollmentRow;
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
  showProgress,
  canManage,
  expanded,
  onToggle,
  onRecord,
  onStatusChange,
}: StudentRowProps) {
  const { t } = useTranslation('programs');
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

  return (
    <li className="rounded-md border border-border">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="flex-1">
            <span className="font-medium">{row.student.full_name}</span>
            {row.student.roll_number && (
              <span className="text-sm text-muted-foreground"> · {row.student.roll_number}</span>
            )}
          </span>
        </button>

        {showProgress && (
          <ProgressBar
            done={row.achieved_count}
            total={row.milestone_total}
            label={t('students.progress', { done: row.achieved_count, total: row.milestone_total })}
          />
        )}

        <Button type="button" variant="outline" onClick={onRecord}>
          {t('students.record')}
        </Button>

        {canManage && (
          <Menu>
            <MenuTrigger asChild>
              <Button type="button" variant="outline" aria-label={t('students.markComplete')}>
                ⋮
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => onStatusChange('COMPLETED')}>
                {complete ? t('students.completePrompt') : t('students.markComplete')}
              </MenuItem>
              <MenuItem onSelect={() => onStatusChange('WITHDRAWN')}>
                {t('students.withdraw')}
              </MenuItem>
              <MenuItem onSelect={() => onStatusChange('ACTIVE')}>
                {t('students.reactivate')}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>

      {expanded && entry && (
        <div className="border-t border-border p-2" ref={milestonesContainerRef}>
          <MilestoneChecklist
            items={entry.milestones.map((m) => ({
              id: m.id,
              name: m.name,
              achievedOn: m.achievement?.achieved_on ?? null,
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
