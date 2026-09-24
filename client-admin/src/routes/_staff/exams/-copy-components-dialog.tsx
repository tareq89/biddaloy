/**
 * Copy-components dialog — [19.6.1], D9. Source is either another subject
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
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import * as React from 'react';

export interface CopySubjectOption {
  subject_id: string;
  name: string;
}

export interface CopyComponentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  classId: string;
  subjects: CopySubjectOption[];
}

type SourceMode = 'subject' | 'exam';

export function CopyComponentsDialog({
  open,
  onOpenChange,
  examId,
  classId,
  subjects,
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

  React.useEffect(() => {
    if (!open) return;
    setSourceMode('subject');
    setSourceSubjectId('');
    setSourceExamId('');
    setSourceExamSubjectId('');
    setTargetSubjectIds(new Set());
    copyMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close
  }, [open]);

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
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('copyDialog.title')}</DialogTitle>
          <DialogDescription>{t('copyDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t('copyDialog.sourceLabel')}</legend>
            <RadioGroup value={sourceMode} onValueChange={(v) => setSourceMode(v as SourceMode)}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="subject" />
                {t('copyDialog.sourceModeSubject')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="exam" />
                {t('copyDialog.sourceModeExam')}
              </label>
            </RadioGroup>
          </fieldset>

          {sourceMode === 'subject' ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('copyDialog.sourceSubjectLabel')}</span>
              <Select value={sourceSubjectId} onValueChange={setSourceSubjectId}>
                <SelectTrigger aria-label={t('copyDialog.sourceSubjectLabel')}>
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
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('copyDialog.sourceExamLabel')}</span>
                <Select value={sourceExamId} onValueChange={setSourceExamId}>
                  <SelectTrigger aria-label={t('copyDialog.sourceExamLabel')}>
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
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('copyDialog.sourceSubjectLabel')}</span>
                <Select value={sourceExamSubjectId} onValueChange={setSourceExamSubjectId}>
                  <SelectTrigger aria-label={t('copyDialog.sourceSubjectLabel')}>
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
            </>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t('copyDialog.targetsLabel')}</legend>
            {subjects
              .filter((s) => sourceMode === 'exam' || s.subject_id !== effectiveSourceSubjectId)
              .map((s) => (
                <label key={s.subject_id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={targetSubjectIds.has(s.subject_id)}
                    onCheckedChange={() => toggleTarget(s.subject_id)}
                  />
                  {s.name}
                </label>
              ))}
          </fieldset>

          {targetSubjectIds.size > 0 && (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t('copyDialog.previewTitle')}</p>
              {preview.map((row) => (
                <div key={row.subjectId} className="text-sm">
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
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {row.skipped.map((s) => (
                        <li key={s.name}>
                          {s.name} — {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.created.length === 0 && row.skipped.length === 0 && (
                    <p className="text-muted-foreground">{t('copyDialog.previewNothing')}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {copyMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {copyMutation.error instanceof Error
                ? copyMutation.error.message
                : t('copyDialog.errorMessage')}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleConfirm}
            loading={copyMutation.isPending}
            disabled={!canConfirm}
          >
            {t('copyDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
