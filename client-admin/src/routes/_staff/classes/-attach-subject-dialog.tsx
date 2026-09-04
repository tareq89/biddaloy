/**
 * [9.1] Attach-a-subject dialog for the class detail page's Subjects tab.
 * Mirrors `-section-form-dialog.tsx`'s self-contained shape (owns its own
 * mutation directly) — a single "which subject, is it optional" form, no
 * cross-dialog choreography.
 */
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useAttachClassSubject, useSubjects } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AttachSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  academicYearId: string;
  /** Subjects already offered by this class this academic year, excluded
   * from the picker so the same subject can't be attached twice. */
  excludeSubjectIds: string[];
  onSaved: () => void;
}

export function AttachSubjectDialog({
  open,
  onOpenChange,
  classId,
  academicYearId,
  excludeSubjectIds,
  onSaved,
}: AttachSubjectDialogProps) {
  const { t } = useTranslation('classes');
  const subjectsQuery = useSubjects({ is_active: true, limit: 100 });
  const attachSubject = useAttachClassSubject(classId, academicYearId);

  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [isOptional, setIsOptional] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSubjectId(null);
    setIsOptional(false);
    setValidationError(null);
    attachSubject.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const excluded = new Set(excludeSubjectIds);
  const subjectOptions = (subjectsQuery.data?.data ?? [])
    .filter((subject) => !excluded.has(subject.id))
    .map((subject) => ({ value: subject.id, label: `${subject.name_en} (${subject.code})` }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!subjectId) {
      setValidationError(t('subjectAttachForm.errorSubjectRequired'));
      return;
    }
    setValidationError(null);

    attachSubject.mutate(
      { subject_id: subjectId, academic_year_id: academicYearId, is_optional: isOptional },
      { onSuccess: onSaved },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('subjectAttachForm.title')}</DialogTitle>
            <DialogDescription>{t('subjectAttachForm.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('subjectAttachForm.subjectLabel')}</span>
            <Combobox
              aria-label={t('subjectAttachForm.subjectLabel')}
              options={subjectOptions}
              value={subjectId}
              onValueChange={setSubjectId}
              placeholder={t('subjectAttachForm.subjectPlaceholder')}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="attach-subject-optional"
              checked={isOptional}
              onCheckedChange={(checked) => setIsOptional(checked === true)}
            />
            <label htmlFor="attach-subject-optional" className="text-sm">
              {t('subjectAttachForm.optionalLabel')}
            </label>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {attachSubject.isError && (
            <p role="alert" className="text-sm text-destructive">
              {attachSubject.error instanceof Error
                ? attachSubject.error.message
                : t('subjectAttachForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={attachSubject.isPending}>
              {attachSubject.isPending
                ? t('subjectAttachForm.saving')
                : t('subjectAttachForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
