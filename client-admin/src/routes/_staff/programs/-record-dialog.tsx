/**
 * Record achievements — [34.4.1], D5; a full-page modal since 31.4.programs-2b (D21).
 * Milestone select (prefilled), checkbox list of ACTIVE enrolments (prefilled with one when
 * opened from a Students-tab row), achieved_on/score/grade/remark. `Enter` in a field submits
 * (a hidden submit button makes the browser's implicit submission work). Name, props and
 * export are unchanged — the students page mounts it from local state too.
 */
import {
  DatePicker,
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
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { toIsoDate, toLatinDigits } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { DiscardConfirm } from './-discard-confirm';
import { LabelledField } from './-labelled-field';
import { StudentPickCard } from './-student-pick-card';

const sameSet = (a: ReadonlySet<string>, b: readonly string[]) =>
  a.size === b.length && b.every((x) => a.has(x));

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
  const regionConfig = useTenantRegionConfig();

  const [selectedProgramId, setSelectedProgramId] = React.useState(programId);
  const [selectedMilestoneId, setSelectedMilestoneId] = React.useState(milestoneId ?? '');
  const [enrollmentIds, setEnrollmentIds] = React.useState<Set<string>>(
    new Set(enrollmentIdPrefill ? [enrollmentIdPrefill] : []),
  );
  const [achievedOn, setAchievedOn] = React.useState<Date>(() => new Date());
  const [score, setScore] = React.useState('');
  const [grade, setGrade] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [scoreInvalid, setScoreInvalid] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelectedProgramId(programId);
    setSelectedMilestoneId(milestoneId ?? '');
    setEnrollmentIds(new Set(enrollmentIdPrefill ? [enrollmentIdPrefill] : []));
    setAchievedOn(new Date());
    setScore('');
    setGrade('');
    setRemark('');
    setScoreInvalid(false);
    setDiscardOpen(false);
  }, [open, programId, milestoneId, enrollmentIdPrefill]);

  const programsQuery = usePrograms();
  const programQuery = useProgram(selectedProgramId || undefined);
  const enrollmentsQuery = useProgramEnrollments(selectedProgramId || undefined, {
    status: 'ACTIVE',
  });
  const recordAchievements = useRecordAchievements();

  const milestones: ProgramMilestone[] = programQuery.data?.milestones ?? [];
  const enrollments = enrollmentsQuery.data ?? [];
  const busy = recordAchievements.isPending;
  // Only ids the user can see are submitted: a prefilled id outside the loaded list is ignored.
  const visibleIds = enrollments.filter((e) => enrollmentIds.has(e.id)).map((e) => e.id);
  const dirty =
    selectedProgramId !== programId ||
    selectedMilestoneId !== (milestoneId ?? '') ||
    !sameSet(enrollmentIds, enrollmentIdPrefill ? [enrollmentIdPrefill] : []) ||
    toIsoDate(achievedOn) !== toIsoDate(new Date()) ||
    score !== '' ||
    grade !== '' ||
    remark !== '';

  function toggleEnrollment(id: string) {
    setEnrollmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const allSelected = enrollments.every((e) => enrollmentIds.has(e.id));
    setEnrollmentIds(allSelected ? new Set() : new Set(enrollments.map((e) => e.id)));
  }

  function close() {
    if (!busy) onOpenChange(false);
  }

  function submit() {
    if (!selectedProgramId || !selectedMilestoneId || visibleIds.length === 0) return;
    // Bangla digits are accepted: normalise before parsing instead of rejecting them.
    const scoreText = toLatinDigits(score).trim().replace(',', '.');
    const parsedScore = scoreText ? Number(scoreText) : undefined;
    // Server DTO: >= 0, <= 9999.99, at most 2 decimals.
    if (
      parsedScore !== undefined &&
      (!/^\d+(\.\d{1,2})?$/.test(scoreText) || parsedScore > 9999.99)
    ) {
      setScoreInvalid(true);
      return;
    }
    setScoreInvalid(false);
    // Row-record opened from the URL has no `studentId` prop: take it from the prefilled enrolment.
    const onlyPrefilled = visibleIds.length === 1 && visibleIds[0] === enrollmentIdPrefill;
    const optimisticStudentId = onlyPrefilled
      ? (studentId ?? enrollments.find((e) => e.id === enrollmentIdPrefill)?.student.id)
      : undefined;
    recordAchievements.mutate(
      {
        programId: selectedProgramId,
        ...(optimisticStudentId ? { studentId: optimisticStudentId } : {}),
        input: {
          enrollment_ids: visibleIds,
          milestone_id: selectedMilestoneId,
          achieved_on: toIsoDate(achievedOn),
          ...(parsedScore !== undefined ? { score: parsedScore } : {}),
          ...(grade.trim() ? { grade: grade.trim() } : {}),
          ...(remark.trim() ? { remark: remark.trim() } : {}),
        },
      },
      { onSuccess: onRecorded },
    );
  }

  if (!open) return null;

  return (
    <FullPageShell
      title={t('dialogs.record.title')}
      onClose={close}
      dirty={dirty}
      primary={{
        label: t('dialogs.record.save'),
        onClick: submit,
        busy,
        disabled: !selectedProgramId || !selectedMilestoneId || visibleIds.length === 0,
      }}
      secondary={{
        label: tCommon('actions.cancel'),
        onClick: () => (busy ? undefined : dirty ? setDiscardOpen(true) : close()),
      }}
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="submit" hidden aria-hidden tabIndex={-1} />
        <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {!programId && (
              <LabelledField id="record-program" label={t('dialogs.program')} required>
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
                  <SelectTrigger id="record-program" className="w-full">
                    <SelectValue placeholder={t('dialogs.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(programsQuery.data ?? []).map((program) => (
                      <SelectItem key={program.id} value={program.id}>
                        {program.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabelledField>
            )}

            <LabelledField id="record-milestone" label={t('dialogs.record.milestone')} required>
              <Select value={selectedMilestoneId} onValueChange={setSelectedMilestoneId}>
                <SelectTrigger id="record-milestone" className="w-full">
                  <SelectValue placeholder={t('dialogs.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {milestones.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>

            <LabelledField id="record-achieved-on" label={t('dialogs.record.achievedOn')}>
              <DatePicker
                id="record-achieved-on"
                aria-label={t('dialogs.record.achievedOn')}
                config={regionConfig}
                value={achievedOn}
                onValueChange={(d) => d && setAchievedOn(d)}
              />
            </LabelledField>

            <LabelledField id="record-score" label={t('dialogs.record.score')}>
              <Input
                id="record-score"
                inputMode="decimal"
                aria-invalid={scoreInvalid || undefined}
                value={score}
                onChange={(e) => {
                  setScore(e.target.value);
                  setScoreInvalid(false);
                }}
              />
              {scoreInvalid && (
                <p role="alert" className="text-destructive">
                  {t('dialogs.record.scoreInvalid')}
                </p>
              )}
            </LabelledField>

            <LabelledField id="record-grade" label={t('dialogs.record.grade')}>
              <Input id="record-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
            </LabelledField>

            <LabelledField id="record-remark" label={t('dialogs.record.remark')}>
              <Textarea
                id="record-remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </LabelledField>
          </div>
        </section>

        <StudentPickCard
          label={t('dialogs.record.students')}
          items={enrollments.map((e) => ({
            id: e.id,
            name: e.student.full_name,
            roll: e.student.roll_number,
          }))}
          selected={enrollmentIds}
          onToggle={toggleEnrollment}
          onToggleAll={toggleAll}
          emptyText={t('dialogs.record.noStudents')}
        />

        {recordAchievements.isError && (
          <p role="alert" className="flex items-center gap-1.5 text-destructive">
            <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
            {t('dialogs.record.errorMessage')}
          </p>
        )}
      </form>
      <DiscardConfirm
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={() => {
          setDiscardOpen(false);
          close();
        }}
      />
    </FullPageShell>
  );
}
