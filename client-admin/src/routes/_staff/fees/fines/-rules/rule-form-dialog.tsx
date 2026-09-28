/**
 * [38.4a] Create/edit `FineRule` dialog for the Rules tab — cloned from
 * `fees/schedules/-schedule-form-dialog.tsx`'s Tier B shape (plain
 * `useState`, no react-hook-form).
 *
 * `conditionsFields(trigger)` is the one place a new trigger's
 * trigger-specific inputs get added (ticket step 2's D6): today only
 * `ATTENDANCE_LATE` has one (`min_minutes_late`), `ATTENDANCE_ABSENT` has
 * none.
 */
import { FineTrigger, type FeeType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
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
  useClasses,
  useCreateFineRule,
  useFeeStructures,
  useUpdateFineRule,
  type CreateFineRuleInput,
  type FineRule,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const NO_CLASS = '__none__';
const FINE_FEE_TYPE = 'FINE' as FeeType;

export interface RuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  academicYearId: string;
  rule?: FineRule;
  onSaved: () => void;
}

/** [D6] One case per trigger. A trigger with no extra conditions returns
 * `null` and `buildConditions` sends `{}`. */
function conditionsFields(
  trigger: FineTrigger,
  minMinutesLate: number,
  setMinMinutesLate: (value: number) => void,
  t: (key: string) => string,
): React.ReactNode {
  switch (trigger) {
    case FineTrigger.ATTENDANCE_LATE:
      return (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fine-rule-min-minutes-late" className="text-sm font-medium">
            {t('fines.rules.form.minMinutesLateLabel')}
          </label>
          <Input
            id="fine-rule-min-minutes-late"
            type="number"
            min={0}
            value={minMinutesLate}
            onChange={(event) => setMinMinutesLate(Number(event.target.value))}
          />
        </div>
      );
    case FineTrigger.ATTENDANCE_ABSENT:
      return null;
    default:
      return null;
  }
}

function buildConditions(trigger: FineTrigger, minMinutesLate: number): Record<string, unknown> {
  if (trigger === FineTrigger.ATTENDANCE_LATE) return { min_minutes_late: minMinutesLate };
  return {};
}

export function RuleFormDialog({
  open,
  onOpenChange,
  mode,
  academicYearId,
  rule,
  onSaved,
}: RuleFormDialogProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  const createRule = useCreateFineRule();
  const updateRule = useUpdateFineRule(academicYearId);
  const mutation = mode === 'create' ? createRule : updateRule;

  const [trigger, setTrigger] = React.useState<FineTrigger>(
    (rule?.trigger as FineTrigger | undefined) ?? FineTrigger.ATTENDANCE_ABSENT,
  );
  const [feeStructureId, setFeeStructureId] = React.useState(rule?.fee_structure_id ?? '');
  const [classId, setClassId] = React.useState(rule?.class_id ?? '');
  const [freePerPeriod, setFreePerPeriod] = React.useState(rule?.free_per_period ?? 0);
  const [capPerPeriod, setCapPerPeriod] = React.useState<number | undefined>(
    rule?.cap_per_period ?? undefined,
  );
  const [minMinutesLate, setMinMinutesLate] = React.useState<number>(
    typeof rule?.conditions.min_minutes_late === 'number' ? rule.conditions.min_minutes_late : 0,
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const feesQuery = useFeeStructures({ academic_year_id: academicYearId, fee_type: FINE_FEE_TYPE });
  const classesQuery = useClasses({ academic_year_id: academicYearId });

  React.useEffect(() => {
    if (!open) return;
    mutation.reset();
    setTrigger((rule?.trigger as FineTrigger | undefined) ?? FineTrigger.ATTENDANCE_ABSENT);
    setFeeStructureId(rule?.fee_structure_id ?? '');
    setClassId(rule?.class_id ?? '');
    setFreePerPeriod(rule?.free_per_period ?? 0);
    setCapPerPeriod(rule?.cap_per_period ?? undefined);
    setMinMinutesLate(
      typeof rule?.conditions.min_minutes_late === 'number' ? rule.conditions.min_minutes_late : 0,
    );
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function buildInput(): CreateFineRuleInput | null {
    if (feeStructureId === '') {
      setValidationError(t('fines.rules.form.feeStructureRequired'));
      return null;
    }
    setValidationError(null);
    return {
      academic_year_id: academicYearId,
      trigger,
      fee_structure_id: feeStructureId,
      ...(classId !== '' ? { class_id: classId } : {}),
      free_per_period: freePerPeriod,
      ...(capPerPeriod !== undefined ? { cap_per_period: capPerPeriod } : {}),
      conditions: buildConditions(trigger, minMinutesLate),
    };
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const input = buildInput();
    if (!input) return;
    if (mode === 'create') {
      createRule.mutate(input, { onSuccess: onSaved });
      return;
    }
    updateRule.mutate(
      {
        id: rule?.id ?? '',
        fee_structure_id: input.fee_structure_id,
        ...(input.class_id !== undefined ? { class_id: input.class_id } : {}),
        free_per_period: freePerPeriod,
        ...(capPerPeriod !== undefined ? { cap_per_period: capPerPeriod } : {}),
        conditions: buildConditions(trigger, minMinutesLate),
      },
      { onSuccess: onSaved },
    );
  }

  const duplicateMessage =
    mutation.error instanceof ApiError && mutation.error.statusCode === 409
      ? mutation.error.message
      : null;

  const isEdit = mode === 'edit';
  const title = isEdit ? t('fines.rules.form.editTitle') : t('fines.rules.form.createTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('fines.rules.form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('fines.rules.form.triggerLabel')}</span>
            <Select
              value={trigger}
              onValueChange={(value) => setTrigger(value as FineTrigger)}
              disabled={isEdit}
            >
              <SelectTrigger aria-label={t('fines.rules.form.triggerLabel')} disabled={isEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FineTrigger.ATTENDANCE_ABSENT}>
                  {t('fines.rules.form.triggerAbsent')}
                </SelectItem>
                <SelectItem value={FineTrigger.ATTENDANCE_LATE}>
                  {t('fines.rules.form.triggerLate')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('fines.rules.form.feeStructureLabel')}</span>
            <Select value={feeStructureId} onValueChange={setFeeStructureId}>
              <SelectTrigger aria-label={t('fines.rules.form.feeStructureLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(feesQuery.data?.data ?? []).map((fee) => (
                  <SelectItem key={fee.id} value={fee.id}>
                    {fee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('fines.rules.form.classLabel')}</span>
            <Select
              value={classId === '' ? NO_CLASS : classId}
              onValueChange={(value) => setClassId(value === NO_CLASS ? '' : value)}
            >
              <SelectTrigger aria-label={t('fines.rules.form.classLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS}>{t('fines.rules.form.wholeSchool')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {duplicateMessage && (
              <p role="alert" className="text-sm text-destructive">
                {duplicateMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fine-rule-free-per-period" className="text-sm font-medium">
              {t('fines.rules.form.freePerPeriodLabel')}
            </label>
            <Input
              id="fine-rule-free-per-period"
              type="number"
              min={0}
              value={freePerPeriod}
              onChange={(event) => setFreePerPeriod(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('fines.rules.form.capLabel')}</span>
            <MoneyInput
              value={capPerPeriod}
              onValueChange={setCapPerPeriod}
              config={regionConfig}
              aria-label={t('fines.rules.form.capLabel')}
            />
          </div>

          {conditionsFields(trigger, minMinutesLate, setMinMinutesLate, t)}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && !duplicateMessage && (
            <p role="alert" className="text-sm text-destructive">
              {t('fines.rules.form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('fines.rules.form.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('fines.rules.form.saving') : t('fines.rules.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
