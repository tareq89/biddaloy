/**
 * [8.11.5]'s shared Create/Edit fee-structure dialog. Tier B form — plain
 * `useState`, like `academic-years/-year-form-dialog.tsx` — because
 * `FormShell`/react-hook-form's machinery (autosave, unsaved-changes
 * warning, submit-error focus summary) earns its keep on the Student
 * admission form's field count, not on a modal this size.
 *
 * One behaviour the API still forces on this dialog: `UpdateFeeStructureDto`
 * accepts no `academic_year_id`, so in edit mode that field renders
 * disabled. `class_id`/`section_id` are patchable in both modes.
 */
import { FeeType } from '@biddaloy/shared';
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
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useClasses,
  useClassSections,
  useCreateFeeStructure,
  useUpdateFeeStructure,
  type FeeStructure,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { minorUnitsToDecimalString, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import * as React from 'react';

/** Radix `Select.Item` rejects an empty-string `value`, so "no section"
 * needs a real sentinel — `section_id` is never this string. */
const NO_SECTION = '__none__';
/** Same sentinel trick for "no class" — a school-wide structure has a
 * null `class_id`, which Radix's `Select.Item` also can't represent
 * directly. */
const NO_CLASS = '__none__';

export interface StructureFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** The list row being edited. */
  structure?: FeeStructure;
  onSaved: () => void;
}

export function StructureFormDialog({
  open,
  onOpenChange,
  mode,
  structure,
  onSaved,
}: StructureFormDialogProps) {
  const { t } = useTranslation('feeStructures');
  const regionConfig = useRegionConfig();

  const createStructure = useCreateFeeStructure();
  const updateStructure = useUpdateFeeStructure(structure?.id ?? '');
  const mutation = mode === 'create' ? createStructure : updateStructure;

  const yearsQuery = useAcademicYears();
  const [academicYearId, setAcademicYearId] = React.useState(structure?.academic_year_id ?? '');
  const [classId, setClassId] = React.useState(structure?.class_id ?? '');
  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== '' ? classId : undefined);

  const [name, setName] = React.useState(structure?.name ?? '');
  const [feeType, setFeeType] = React.useState<FeeType>(
    (structure?.fee_type as FeeType) ?? FeeType.MONTHLY_TUITION,
  );
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(undefined);
  const [sectionId, setSectionId] = React.useState(structure?.section_id ?? '');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Reset only on open/close transitions, so typing isn't clobbered by a
  // background refetch of the list the `structure` prop came from.
  React.useEffect(() => {
    if (!open) return;
    mutation.reset();
    setName(structure?.name ?? '');
    setFeeType((structure?.fee_type as FeeType) ?? FeeType.MONTHLY_TUITION);
    setAmountMinorUnits(
      structure ? serverAmountToMinorUnits(structure.amount, regionConfig) : undefined,
    );
    setAcademicYearId(structure?.academic_year_id ?? '');
    setClassId(structure?.class_id ?? '');
    setSectionId(structure?.section_id ?? '');
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (name.trim() === '') {
      setValidationError(t('form.errorNameRequired'));
      return;
    }
    if (amountMinorUnits === undefined || amountMinorUnits <= 0) {
      setValidationError(t('form.errorAmountRequired'));
      return;
    }
    if (mode === 'create' && academicYearId === '') {
      setValidationError(t('form.errorAcademicYearRequired'));
      return;
    }
    setValidationError(null);

    // `MoneyInput` speaks integer minor units; the DTO's `amount` is
    // decimal taka. `minorUnitsToDecimalString` is the only supported
    // bridge between the two — never `parseFloat`/`toFixed`.
    const amount = Number(minorUnitsToDecimalString(amountMinorUnits, regionConfig));

    const shared = {
      fee_type: feeType,
      name: name.trim(),
      amount,
      class_id: classId !== '' ? classId : null,
      // `null`, not an omitted key, is what widens a section-scoped
      // structure back to the whole class — the server leaves the column
      // untouched for keys it doesn't receive.
      section_id: sectionId !== '' ? sectionId : null,
    };

    if (mode === 'create') {
      createStructure.mutate(
        { ...shared, academic_year_id: academicYearId },
        { onSuccess: onSaved },
      );
      return;
    }
    updateStructure.mutate(shared, { onSuccess: onSaved });
  }

  const isEdit = mode === 'edit';
  const title = isEdit ? t('form.editTitle') : t('form.createTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="structure-form-name" className="text-sm font-medium">
              {t('form.nameLabel')}
            </label>
            <Input
              id="structure-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.feeTypeLabel')}</span>
            <Select value={feeType} onValueChange={(value) => setFeeType(value as FeeType)}>
              <SelectTrigger aria-label={t('form.feeTypeLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(FeeType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`feeTypes.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="structure-form-amount" className="text-sm font-medium">
              {t('form.amountLabel')}
            </label>
            <MoneyInput
              id="structure-form-amount"
              config={regionConfig}
              value={amountMinorUnits}
              onValueChange={setAmountMinorUnits}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.academicYearLabel')}</span>
            <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={isEdit}>
              <SelectTrigger aria-label={t('form.academicYearLabel')} disabled={isEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearsQuery.data?.data.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.classLabel')}</span>
            <Select
              value={classId === '' ? NO_CLASS : classId}
              onValueChange={(value) => {
                setClassId(value === NO_CLASS ? '' : value);
                setSectionId('');
              }}
            >
              <SelectTrigger aria-label={t('form.classLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS}>{t('list.wholeSchool')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.sectionLabel')}</span>
            <Select
              value={sectionId === '' ? NO_SECTION : sectionId}
              onValueChange={(value) => setSectionId(value === NO_SECTION ? '' : value)}
            >
              <SelectTrigger aria-label={t('form.sectionLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SECTION}>{t('form.allSections')}</SelectItem>
                {sectionsQuery.data?.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.section_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('form.saving') : t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
