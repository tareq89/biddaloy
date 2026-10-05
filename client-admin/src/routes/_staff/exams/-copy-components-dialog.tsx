/**
 * Copy-parts tool — [19.6.1], D9; a full page (`?copy=1`) since [31.4.exams-2b]. Source is either another subject
 * in this exam, or the same subject in a different exam; targets are a
 * multi-select of subjects. The preview (what will be created vs. what
 * will be skipped) is computed client-side, from data already on hand
 * (the source subject's components + every existing component in this
 * exam), and shown *before* the user confirms — `ExamComponentsService
 * .copy` has no dry-run flag, so this mirrors its own skip rules
 * (name collision, or the target already has an ATTENDANCE component)
 * rather than calling the endpoint twice.
 */
import { ExamComponentKind } from '@biddaloy/shared';
import {
  Checkbox,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useCopyExamComponents,
  useExamComponents,
  useExamComponentsAll,
  useExams,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import * as React from 'react';

export interface CopySubjectOption {
  subject_id: string;
  name: string;
}

export interface CopyComponentsDialogProps {
  examId: string;
  classId: string;
  subjects: CopySubjectOption[];
  /** Closing drops `?copy=1` — the parent owns that. */
  onClose: () => void;
}

const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';
const ROW = 'flex min-h-11 items-center gap-3 md:min-h-8';

type SourceMode = 'subject' | 'exam';

export function CopyComponentsDialog({
  examId,
  classId,
  subjects,
  onClose,
}: CopyComponentsDialogProps) {
  const { t } = useTranslation('exams');
  const [sourceMode, setSourceMode] = React.useState<SourceMode>('subject');
  const [sourceSubjectId, setSourceSubjectId] = React.useState('');
  const [sourceExamId, setSourceExamId] = React.useState('');
  const [sourceExamSubjectId, setSourceExamSubjectId] = React.useState('');
  const [targetSubjectIds, setTargetSubjectIds] = React.useState<Set<string>>(new Set());

  const otherExamsQuery = useExams({ class_id: classId, limit: 100 });
  const otherExams = (otherExamsQuery.data?.data ?? []).filter((e) => e.id !== examId);

  const effectiveSourceExamId = sourceMode === 'exam' ? sourceExamId : examId;
  const effectiveSourceSubjectId = sourceMode === 'exam' ? sourceExamSubjectId : sourceSubjectId;

  const sourceComponentsQuery = useExamComponents(
    effectiveSourceExamId || undefined,
    effectiveSourceSubjectId || undefined,
  );
  const targetComponentsQuery = useExamComponentsAll(examId);
  const copyMutation = useCopyExamComponents(examId);
  // `saved` clears `dirty` before closing, so the unsaved-changes guard stays out of the way.
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (saved) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close once, when saved flips
  }, [saved]);

  // Only 'subject' mode's source can also be checked as a target (in
  // 'exam' mode the source subject lives in a different exam, so it never
  // collides) — clear it from targetSubjectIds if it's already checked, or
  // handleConfirm would send a subject as both its own source and target.
  React.useEffect(() => {
    if (sourceMode !== 'subject' || !sourceSubjectId) return;
    setTargetSubjectIds((prev) => {
      if (!prev.has(sourceSubjectId)) return prev;
      const next = new Set(prev);
      next.delete(sourceSubjectId);
      return next;
    });
  }, [sourceMode, sourceSubjectId]);

  function toggleTarget(subjectId: string) {
    setTargetSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  const sourceComponents = sourceComponentsQuery.data ?? [];
  const allTargetComponents = targetComponentsQuery.data ?? [];

  // Same skip rules as `ExamComponentsService.copy`: a name collision, or
  // (for an ATTENDANCE source component) the target already having one.
  const preview = React.useMemo(() => {
    const targets = [...targetSubjectIds];
    return targets.map((subjectId) => {
      const existing = allTargetComponents.filter((c) => c.subject_id === subjectId);
      const existingNames = new Set(existing.map((c) => c.name));
      const hasAttendance = existing.some((c) => c.kind === ExamComponentKind.ATTENDANCE);
      const created: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      let attendanceAlready = hasAttendance;
      for (const component of sourceComponents) {
        if (existingNames.has(component.name)) {
          skipped.push({ name: component.name, reason: t('copyDialog.reasonNameExists') });
          continue;
        }
        if (component.kind === ExamComponentKind.ATTENDANCE && attendanceAlready) {
          skipped.push({ name: component.name, reason: t('copyDialog.reasonAttendanceExists') });
          continue;
        }
        if (component.kind === ExamComponentKind.ATTENDANCE) attendanceAlready = true;
        created.push(component.name);
      }
      const subjectName = subjects.find((s) => s.subject_id === subjectId)?.name ?? subjectId;
      return { subjectId, subjectName, created, skipped };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is stable enough for this preview
  }, [targetSubjectIds, allTargetComponents, sourceComponents, subjects]);

  const started = effectiveSourceSubjectId !== '' || targetSubjectIds.size > 0;
  const totalCreated = preview.reduce((n, row) => n + row.created.length, 0);
  const canConfirm =
    effectiveSourceSubjectId !== '' && targetSubjectIds.size > 0 && sourceComponents.length > 0;

  function handleConfirm() {
    if (!canConfirm) return;
    copyMutation.mutate(
      {
        source_exam_id: effectiveSourceExamId,
        source_subject_id: effectiveSourceSubjectId,
        target_subject_ids: [...targetSubjectIds],
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <FullPageShell
      title={t('copyDialog.title')}
      size="form"
      dirty={started && !saved}
      onClose={onClose}
      secondary={{ label: t('copyDialog.cancel'), onClick: onClose }}
      primary={{
        label: t('copyDialog.confirm'),
        onClick: handleConfirm,
        busy: copyMutation.isPending,
        disabled: !canConfirm || totalCreated === 0,
      }}
    >
      <div className="flex flex-col gap-6">
        <p className="text-text-secondary">{t('copyDialog.description')}</p>

        <section className={`${CARD} flex flex-col gap-4 p-4 md:p-5`}>
          <h2 className="text-h2">{t('copyDialog.sourceCard')}</h2>
          <RadioGroup
            value={sourceMode}
            onValueChange={(v) => setSourceMode(v as SourceMode)}
            aria-label={t('copyDialog.sourceLabel')}
          >
            <label className={ROW}>
              <RadioGroupItem value="subject" />
              {t('copyDialog.sourceModeSubject')}
            </label>
            <label className={ROW}>
              <RadioGroupItem value="exam" />
              {t('copyDialog.sourceModeExam')}
            </label>
          </RadioGroup>

          {sourceMode === 'exam' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copy-source-exam">{t('copyDialog.sourceExamLabel')}</Label>
              <Select value={sourceExamId} onValueChange={setSourceExamId}>
                <SelectTrigger id="copy-source-exam" className="w-full">
                  <SelectValue placeholder={t('copyDialog.sourceExamPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {otherExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-source-subject">{t('copyDialog.sourceSubjectLabel')}</Label>
            <Select
              value={sourceMode === 'exam' ? sourceExamSubjectId : sourceSubjectId}
              onValueChange={sourceMode === 'exam' ? setSourceExamSubjectId : setSourceSubjectId}
            >
              <SelectTrigger id="copy-source-subject" className="w-full">
                <SelectValue placeholder={t('copyDialog.sourceSubjectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.subject_id} value={s.subject_id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className={`${CARD} flex flex-col gap-2 p-4 md:p-5`}>
          <h2 className="text-h2">{t('copyDialog.targetsLabel')}</h2>
          {subjects
            .filter((s) => sourceMode === 'exam' || s.subject_id !== effectiveSourceSubjectId)
            .map((s) => (
              <label key={s.subject_id} className={ROW}>
                <Checkbox
                  checked={targetSubjectIds.has(s.subject_id)}
                  onCheckedChange={() => toggleTarget(s.subject_id)}
                />
                {s.name}
              </label>
            ))}
        </section>

        {targetSubjectIds.size > 0 && (
          <section className={`${CARD} flex flex-col gap-3 p-4 md:p-5`}>
            <h2 className="text-h2">{t('copyDialog.previewTitle')}</h2>
            {preview.map((row) => (
              <div key={row.subjectId}>
                <p className="font-medium">{row.subjectName}</p>
                {row.created.length > 0 && (
                  <p>
                    {t('copyDialog.previewCreated', {
                      count: row.created.length,
                      names: row.created.join(', '),
                    })}
                  </p>
                )}
                {row.skipped.length > 0 && (
                  <>
                    <p className="mt-2 text-caption text-text-secondary">
                      {t('copyDialog.skippedTitle')}
                    </p>
                    <ul className="divide-y divide-border-subtle text-text-secondary">
                      {row.skipped.map((s) => (
                        <li key={s.name} className="py-1.5">
                          {s.name} — {s.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {row.created.length === 0 && row.skipped.length === 0 && (
                  <p className="text-text-secondary">{t('copyDialog.previewNothing')}</p>
                )}
              </div>
            ))}
          </section>
        )}

        {copyMutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('copyDialog.errorMessage')}
          </p>
        )}
      </div>
    </FullPageShell>
  );
}
