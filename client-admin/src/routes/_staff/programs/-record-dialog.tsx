/**
 * Record achievements — [34.4.1], D5. Milestone select (prefilled),
 * multi-select of ACTIVE enrolments (prefilled with one when opened from a
 * Students-tab row), achieved_on/score/grade/remark. `Enter` submits (a
 * plain form submit already does this natively); on success focus returns
 * to whichever element invoked the dialog (the caller passes
 * `returnFocusRef`, same contract `Dialog`'s own focus-trap already
 * expects — closing it restores focus to the trigger unless told
 * otherwise).
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useProgram,
  useProgramEnrollments,
  usePrograms,
  useRecordAchievements,
  type ProgramMilestone,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface RecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  milestoneId?: string | undefined;
  enrollmentIdPrefill?: string | undefined;
  studentId?: string | undefined;
  onRecorded: () => void;
}

export function RecordDialog({
  open,
  onOpenChange,
  programId,
  milestoneId,
  enrollmentIdPrefill,
  studentId,
  onRecorded,
}: RecordDialogProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');

  const [selectedProgramId, setSelectedProgramId] = React.useState(programId);
  const [selectedMilestoneId, setSelectedMilestoneId] = React.useState(milestoneId ?? '');
  const [enrollmentIds, setEnrollmentIds] = React.useState<Set<string>>(
    new Set(enrollmentIdPrefill ? [enrollmentIdPrefill] : []),
  );
  const [achievedOn, setAchievedOn] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [score, setScore] = React.useState('');
  const [grade, setGrade] = React.useState('');
  const [remark, setRemark] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setSelectedProgramId(programId);
    setSelectedMilestoneId(milestoneId ?? '');
    setEnrollmentIds(new Set(enrollmentIdPrefill ? [enrollmentIdPrefill] : []));
    setAchievedOn(new Date().toISOString().slice(0, 10));
    setScore('');
    setGrade('');
    setRemark('');
  }, [open, programId, milestoneId, enrollmentIdPrefill]);

  const programsQuery = usePrograms();
  const programQuery = useProgram(selectedProgramId || undefined);
  const enrollmentsQuery = useProgramEnrollments(selectedProgramId || undefined, {
    status: 'ACTIVE',
  });
  const recordAchievements = useRecordAchievements();

  const milestones: ProgramMilestone[] = programQuery.data?.milestones ?? [];
  const enrollments = enrollmentsQuery.data ?? [];

  function toggleEnrollment(id: string) {
    setEnrollmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProgramId || !selectedMilestoneId || enrollmentIds.size === 0) return;
    const parsedScore = score.trim() ? Number(score) : undefined;
    if (parsedScore !== undefined && Number.isNaN(parsedScore)) return;
    recordAchievements.mutate(
      {
        programId: selectedProgramId,
        ...(studentId ? { studentId } : {}),
        input: {
          enrollment_ids: Array.from(enrollmentIds),
          milestone_id: selectedMilestoneId,
          achieved_on: achievedOn,
          ...(parsedScore !== undefined ? { score: parsedScore } : {}),
          ...(grade.trim() ? { grade: grade.trim() } : {}),
          ...(remark.trim() ? { remark: remark.trim() } : {}),
        },
      },
      { onSuccess: onRecorded },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('dialogs.record.title')}</DialogTitle>
            <DialogDescription>{t('dialogs.record.title')}</DialogDescription>
          </DialogHeader>

          {!programId && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('list.title')}</span>
              <Select
                value={selectedProgramId}
                onValueChange={(value) => {
                  setSelectedProgramId(value);
                  // Milestone/enrolments belong to the *previous* program —
                  // switching programs must not carry them over.
                  setSelectedMilestoneId('');
                  setEnrollmentIds(new Set());
                }}
              >
                <SelectTrigger aria-label={t('list.title')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(programsQuery.data ?? []).map((program) => (
                    <SelectItem key={program.id} value={program.id}>
                      {program.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('dialogs.record.milestone')}</span>
            <Select value={selectedMilestoneId} onValueChange={setSelectedMilestoneId}>
              <SelectTrigger aria-label={t('dialogs.record.milestone')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {milestones.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('dialogs.record.students')}</span>
            <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
              {enrollments.map((row) => (
                <li key={row.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={enrollmentIds.has(row.id)}
                      onCheckedChange={() => toggleEnrollment(row.id)}
                    />
                    {row.student.full_name}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="record-achieved-on" className="text-sm font-medium">
              {t('dialogs.record.achievedOn')}
            </label>
            <input
              id="record-achieved-on"
              type="date"
              value={achievedOn}
              onChange={(e) => setAchievedOn(e.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="record-score" className="text-sm font-medium">
              {t('dialogs.record.score')}
            </label>
            <Input
              id="record-score"
              type="number"
              step="0.01"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="record-grade" className="text-sm font-medium">
              {t('dialogs.record.grade')}
            </label>
            <Input id="record-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="record-remark" className="text-sm font-medium">
              {t('dialogs.record.remark')}
            </label>
            <Textarea
              id="record-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          {recordAchievements.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('dialogs.record.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={recordAchievements.isPending}>
              {t('dialogs.record.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
