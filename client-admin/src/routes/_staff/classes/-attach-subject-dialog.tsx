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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useAttachClassSubject, useSubjects } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { ErrorText, Field, useCloseGuard } from './-dialog-kit';

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
  const { t, i18n } = useTranslation('classes');
  const subjectsQuery = useSubjects({ is_active: true, limit: 100 });
  const attachSubject = useAttachClassSubject(classId, academicYearId);

  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [isOptional, setIsOptional] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Callers mount this dialog only while it is open (fresh state each open).
  const { requestClose, discardDialog } = useCloseGuard(
    subjectId !== null || isOptional,
    attachSubject.isPending,
    onOpenChange,
  );

  const excluded = new Set(excludeSubjectIds);
  const subjectOptions = (subjectsQuery.data?.data ?? [])
    .filter((subject) => !excluded.has(subject.id))
    .map((subject) => ({
      value: subject.id,
      label: `${i18n.language === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en} (${subject.code})`,
    }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (attachSubject.isPending) return;

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
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="sm" onInteractOutside={(e) => e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('subjectAttachForm.title')}</DialogTitle>
              <DialogDescription>{t('subjectAttachForm.description')}</DialogDescription>
            </DialogHeader>

            <Field id="attach-subject-subject" label={t('subjectAttachForm.subjectLabel')} required>
              <Combobox
                id="attach-subject-subject"
                aria-label={t('subjectAttachForm.subjectLabel')}
                options={subjectOptions}
                value={subjectId}
                onValueChange={setSubjectId}
                placeholder={t('subjectAttachForm.subjectPlaceholder')}
              />
            </Field>

            <div className="flex min-h-11 items-center gap-2 md:min-h-8">
              <Checkbox
                id="attach-subject-optional"
                checked={isOptional}
                onCheckedChange={(checked) => setIsOptional(checked === true)}
              />
              <label htmlFor="attach-subject-optional" className="flex-1 cursor-pointer">
                {t('subjectAttachForm.optionalLabel')}
              </label>
            </div>

            {validationError && <ErrorText>{validationError}</ErrorText>}
            {attachSubject.isError && <ErrorText>{t('subjectAttachForm.errorMessage')}</ErrorText>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={attachSubject.isPending}
                onClick={requestClose}
              >
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" loading={attachSubject.isPending}>
                {attachSubject.isPending
                  ? t('subjectAttachForm.saving')
                  : t('subjectAttachForm.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  );
}
