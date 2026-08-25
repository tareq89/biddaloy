/**
 * [8.11.5]'s shared Create/Edit fee-structure dialog. Tier B form — plain
 * `useState`, like `academic-years/-year-form-dialog.tsx` — because
 * `FormShell`/react-hook-form's machinery (autosave, unsaved-changes
 * warning, submit-error focus summary) earns its keep on the Student
 * admission form's field count, not on a modal this size.
 *
 * Two behaviours the API forces on this dialog:
 * - `UpdateFeeStructureDto` accepts neither `class_id` nor
 *   `academic_year_id`, so in edit mode both render disabled.
 * - `student_ids` is a **full replacement** set, not a delta — the picker
 *   always submits every selected id, never just the changes.
 */
import { FeeApplicability, FeeType } from '@biddaloy/shared';
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
  useFeeStructure,
  useUpdateFeeStructure,
  type FeeStructure,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { minorUnitsToDecimalString, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import * as React from 'react';

import { FeeStructureStudentPicker } from './-student-picker';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** Radix `Select.Item` rejects an empty-string `value`, so "no section"
 * needs a real sentinel — `section_id` is never this string. */
const NO_SECTION = '__none__';

export interface StructureFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** The list row being edited. Its `selected_students` is always absent
   * (the list endpoint omits the relation), so the dialog refetches the
   * detail to prefill the picker. */
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

  const detailQuery = useFeeStructure(mode === 'edit' && open ? structure?.id : undefined);

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
  const [month, setMonth] = React.useState(String(structure?.month ?? 1));
  const [isRecurring, setIsRecurring] = React.useState(structure?.is_recurring ?? true);
  const [applicability, setApplicability] = React.useState<FeeApplicability>(
    (structure?.applicability as FeeApplicability) ?? FeeApplicability.ALL,
  );
  const [studentIds, setStudentIds] = React.useState<string[]>([]);
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
    setMonth(String(structure?.month ?? 1));
    setIsRecurring(structure?.is_recurring ?? true);
    setApplicability((structure?.applicability as FeeApplicability) ?? FeeApplicability.ALL);
    setStudentIds([]);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  // The picker's prefill arrives on the detail response, not the list row.
  const prefilledStudents = detailQuery.data?.selected_students ?? [];
  const prefillKey = prefilledStudents.map((link) => link.student_id).join(',');
  React.useEffect(() => {
    if (!open || prefillKey === '') return;
    setStudentIds(prefillKey.split(','));
  }, [open, prefillKey]);

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
    if (mode === 'create' && classId === '') {
      setValidationError(t('form.errorClassRequired'));
      return;
    }
    if (applicability === FeeApplicability.SELECTED && studentIds.length === 0) {
      setValidationError(t('form.errorStudentsRequired'));
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
      applicability,
      month: Number(month),
      is_recurring: isRecurring,
      // `null`, not an omitted key, is what widens a section-scoped
      // structure back to the whole class — the server leaves the column
      // untouched for keys it doesn't receive.
      section_id: sectionId !== '' ? sectionId : null,
      // Always the full set, and always sent: the server replaces every link
      // with what it receives, so a delta would silently unlink the rest,
      // and omitting the key when switching to ALL would strand the old
      // pivot rows — they'd reappear pre-checked on the next switch back.
      student_ids: applicability === FeeApplicability.SELECTED ? studentIds : [],
    };

    if (mode === 'create') {
      createStructure.mutate(
        { ...shared, class_id: classId, academic_year_id: academicYearId },
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
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                setSectionId('');
                setStudentIds([]);
              }}
              disabled={isEdit}
            >
              <SelectTrigger aria-label={t('form.classLabel')} disabled={isEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-muted-foreground">{t('form.notPatchableHint')}</p>
            )}
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

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.monthLabel')}</span>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger aria-label={t('form.monthLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t(`months.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isRecurring ? t('form.monthHelpRecurring') : t('form.monthHelpOneTime')}
            </p>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="structure-form-is-recurring"
              checked={isRecurring}
              onCheckedChange={(checked) => setIsRecurring(checked === true)}
            />
            <label htmlFor="structure-form-is-recurring" className="text-sm">
              {t('form.isRecurringLabel')}
            </label>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">{t('form.applicabilityLabel')}</legend>
            <Select
              value={applicability}
              onValueChange={(value) => setApplicability(value as FeeApplicability)}
            >
              <SelectTrigger aria-label={t('form.applicabilityLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FeeApplicability.ALL}>{t('form.applicabilityAll')}</SelectItem>
                <SelectItem value={FeeApplicability.SELECTED}>
                  {t('form.applicabilitySelected')}
                </SelectItem>
              </SelectContent>
            </Select>
          </fieldset>

          {applicability === FeeApplicability.SELECTED && (
            <FeeStructureStudentPicker
              classId={classId === '' ? undefined : classId}
              selectedIds={studentIds}
              onSelectedIdsChange={setStudentIds}
              initialStudents={prefilledStudents
                .map((link) => link.student)
                .filter((student): student is NonNullable<typeof student> => student !== undefined)}
            />
          )}

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
