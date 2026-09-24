/**
 * Create/edit exam dialog — [19.6.1]. Same "owns its own mutation" +
 * form-shell error-surfacing shape as `classes/-class-form-dialog.tsx`.
 *
 * Academic year and class are create-only, mirroring `ClassFormDialog`'s
 * own academic-year rule — `UpdateExamDto` technically accepts both, but
 * `ExamsService.update` rejects the change once any Mark exists, so
 * offering it as an edit-mode field would mostly just surface that 400.
 * Changing an exam's class/year after creation is out of this ticket's
 * scope.
 */
import { ExamKind } from '@biddaloy/shared';
import {
  Button,
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
} from '@biddaloy/ui/components';
import { useAcademicYears, useClasses, useCreateExam, useUpdateExam } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ExamFormInitialValues {
  name: string;
  kind: ExamKind;
}

export interface ExamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  examId?: string;
  initialValues?: ExamFormInitialValues;
  defaultAcademicYearId?: string;
  onSaved: () => void;
}

const EMPTY_VALUES: ExamFormInitialValues = { name: '', kind: ExamKind.TERM };
const EXAM_KINDS = Object.values(ExamKind);

export function ExamFormDialog({
  open,
  onOpenChange,
  mode,
  examId,
  initialValues,
  defaultAcademicYearId,
  onSaved,
}: ExamFormDialogProps) {
  const { t } = useTranslation('exams');
  const academicYearsQuery = useAcademicYears();
  const createExam = useCreateExam();
  const updateExam = useUpdateExam(examId ?? '');
  const mutation = mode === 'create' ? createExam : updateExam;

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [kind, setKind] = React.useState<ExamKind>(initialValues?.kind ?? ExamKind.TERM);
  const [academicYearId, setAcademicYearId] = React.useState(defaultAcademicYearId ?? '');
  const [classId, setClassId] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const classesQuery = useClasses(academicYearId ? { academic_year_id: academicYearId } : {});

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setName(values.name);
    setKind(values.kind);
    setAcademicYearId(defaultAcademicYearId ?? '');
    setClassId('');
    setValidationError(null);
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      setValidationError(t('examForm.errorNameRequired'));
      return;
    }
    if (mode === 'create' && (!academicYearId || !classId)) {
      setValidationError(t('examForm.errorAcademicYearClassRequired'));
      return;
    }
    setValidationError(null);

    if (mode === 'create') {
      createExam.mutate(
        { name: name.trim(), kind, academic_year_id: academicYearId, class_id: classId },
        { onSuccess: onSaved },
      );
    } else {
      updateExam.mutate({ name: name.trim(), kind }, { onSuccess: onSaved });
    }
  }

  const title = mode === 'create' ? t('examForm.createTitle') : t('examForm.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('examForm.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="exam-form-name" className="text-sm font-medium">
              {t('examForm.nameLabel')}
            </label>
            <Input
              id="exam-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('examForm.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('examForm.kindLabel')}</span>
            <Select value={kind} onValueChange={(value) => setKind(value as ExamKind)}>
              <SelectTrigger aria-label={t('examForm.kindLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`kind.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'create' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('examForm.academicYearLabel')}</span>
                <Select
                  value={academicYearId}
                  onValueChange={(value) => {
                    setAcademicYearId(value);
                    setClassId('');
                  }}
                >
                  <SelectTrigger aria-label={t('examForm.academicYearLabel')}>
                    <SelectValue placeholder={t('examForm.academicYearPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYearsQuery.data?.data.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('examForm.classLabel')}</span>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger aria-label={t('examForm.classLabel')}>
                    <SelectValue placeholder={t('examForm.classPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {classesQuery.data?.data.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : t('examForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('examForm.saving') : t('examForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
