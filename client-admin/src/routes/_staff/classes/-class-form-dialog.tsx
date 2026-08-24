/**
 * Create/edit class dialog — [8.11.2]. Same "owns its own mutation"
 * shape as `-section-form-dialog.tsx` (see that file's header comment for
 * why, versus `academic-years/-year-form-dialog.tsx`'s caller-owns-
 * mutation split).
 *
 * Academic year is only editable at create time — `UpdateClassDto`
 * (`classes.dto.ts`) has no `academic_year_id` field, so an existing
 * class can't be moved to a different year through this form.
 */
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
import { useAcademicYears, useCreateClass, useUpdateClass } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ClassFormInitialValues {
  name: string;
  numericGrade: number | undefined;
}

export interface ClassFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required in edit mode — which class `useUpdateClass` targets. */
  classId?: string;
  initialValues?: ClassFormInitialValues;
  /** Create-mode only — which academic year the dialog's Select starts
   * on. Callers pass the list page's own current filter, so "Add class"
   * from an already-filtered list attaches to that year by default
   * instead of forcing a re-pick. */
  defaultAcademicYearId?: string;
  onSaved: () => void;
}

const EMPTY_VALUES: ClassFormInitialValues = { name: '', numericGrade: undefined };

export function ClassFormDialog({
  open,
  onOpenChange,
  mode,
  classId,
  initialValues,
  defaultAcademicYearId,
  onSaved,
}: ClassFormDialogProps) {
  const { t } = useTranslation('classes');
  const academicYearsQuery = useAcademicYears();
  const createClass = useCreateClass();
  const updateClass = useUpdateClass(classId ?? '');
  const mutation = mode === 'create' ? createClass : updateClass;

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [numericGrade, setNumericGrade] = React.useState(
    initialValues?.numericGrade !== undefined ? String(initialValues.numericGrade) : '',
  );
  const [academicYearId, setAcademicYearId] = React.useState(defaultAcademicYearId ?? '');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setName(values.name);
    setNumericGrade(values.numericGrade !== undefined ? String(values.numericGrade) : '');
    setAcademicYearId(defaultAcademicYearId ?? '');
    setValidationError(null);
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      setValidationError(t('classForm.errorNameRequired'));
      return;
    }
    if (mode === 'create' && !academicYearId) {
      setValidationError(t('classForm.errorAcademicYearRequired'));
      return;
    }
    const parsedGrade = numericGrade.trim() === '' ? undefined : Number(numericGrade);
    if (parsedGrade !== undefined && (!Number.isInteger(parsedGrade) || parsedGrade <= 0)) {
      setValidationError(t('classForm.errorGradeInvalid'));
      return;
    }
    setValidationError(null);

    if (mode === 'create') {
      // `exactOptionalPropertyTypes` — `CreateClassDto.numeric_grade?:
      // number` means "may be omitted", not "may be `undefined`";
      // conditionally spreading it in rather than assigning `undefined`
      // directly is what satisfies that (same pattern as
      // `toStudentListFilters` elsewhere in this app). There is no
      // "clear a previously-set grade" case on create — a new class has
      // no previous value — so omitting is the right shape here, unlike
      // update below.
      createClass.mutate(
        {
          name: name.trim(),
          ...(parsedGrade !== undefined ? { numeric_grade: parsedGrade } : {}),
          academic_year_id: academicYearId,
        },
        { onSuccess: onSaved },
      );
    } else {
      // Always sent, as `parsedGrade ?? null` — never conditionally
      // omitted. Omitting the key when the field was cleared (the create
      // branch's shape) would leave the class's existing `numeric_grade`
      // untouched server-side (`ClassService.update` passes the DTO
      // straight into `repo.update()`, which only touches keys actually
      // present), so a user clearing Grade and saving would see "saved"
      // while the old value silently survived. `UpdateClassDto.
      // numeric_grade?: number | null` accepts the explicit `null`.
      updateClass.mutate(
        { name: name.trim(), numeric_grade: parsedGrade ?? null },
        { onSuccess: onSaved },
      );
    }
  }

  const title = mode === 'create' ? t('classForm.createTitle') : t('classForm.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('classForm.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="class-form-name" className="text-sm font-medium">
              {t('classForm.nameLabel')}
            </label>
            <Input
              id="class-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('classForm.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="class-form-grade" className="text-sm font-medium">
              {t('classForm.gradeLabel')}
            </label>
            <Input
              id="class-form-grade"
              type="number"
              value={numericGrade}
              onChange={(event) => setNumericGrade(event.target.value)}
              placeholder={t('classForm.gradePlaceholder')}
            />
          </div>

          {mode === 'create' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('classForm.academicYearLabel')}</span>
              <Select value={academicYearId} onValueChange={setAcademicYearId}>
                <SelectTrigger aria-label={t('classForm.academicYearLabel')}>
                  <SelectValue placeholder={t('classForm.academicYearPlaceholder')} />
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
                : t('classForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('classForm.saving') : t('classForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
