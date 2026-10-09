/**
 * [16.7.6] "Discounts" section of the student's Fees tab — one student's
 * standing discount rules (D8), add/edit/delete through the approval-gated
 * mutation shape `-reverse-payment-dialog.tsx` (16.6.2, wave 6) already
 * established: `useApprovedMutation` turns a plain 403 into a step-up
 * prompt shown by the app-level `<ApprovalModalHostProvider>`, with no
 * extra plumbing here.
 *
 * Kept as its own file (rather than folded into `fees-tab.tsx`) per the
 * plan's file list — `fees-tab.tsx` only needs to mount it inside a new
 * "Discounts" tab.
 */
import { FeeType, Permission } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  RadioGroup,
  RadioGroupItem,
  SkeletonTable,
  Textarea,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCreateDiscountRule,
  useDeleteDiscountRule,
  useDiscountRules,
  useHasPermission,
  useUpdateDiscountRule,
  type DiscountKind,
  type DiscountRule,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatServerAmount,
  parseServerDate,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { PercentIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

const REASON_MIN_LENGTH = 3;
const ALL_FEE_TYPES = Object.values(FeeType).filter((type) => type !== FeeType.LATE_FEE);

export interface DiscountsSectionProps {
  studentId: string;
}

interface RuleFormState {
  kind: DiscountKind;
  value: string;
  allFeeTypes: boolean;
  feeTypes: string[];
  startsOn: string;
  endsOn: string;
  reason: string;
}

function emptyForm(): RuleFormState {
  return {
    kind: 'PERCENT',
    value: '',
    allFeeTypes: true,
    feeTypes: [],
    startsOn: '',
    endsOn: '',
    reason: '',
  };
}

function formFromRule(rule: DiscountRule): RuleFormState {
  return {
    kind: rule.kind,
    value: String(rule.value),
    allFeeTypes: rule.fee_types === null,
    feeTypes: rule.fee_types ?? [],
    startsOn: rule.starts_on ?? '',
    endsOn: rule.ends_on ?? '',
    reason: rule.reason,
  };
}

/** Mirrors the server DTO's validation so bad input never reaches the
 * approval step: PERCENT is bounded 0-100 (D8), FLAT just needs to be
 * positive; the reason has the same non-trivial min length the reverse-
 * payment dialog enforces for the same "explain yourself" reason. Each
 * error names the field it belongs to so it renders under that field. */
type RuleField = 'value' | 'feeTypes' | 'dates' | 'reason';

function validate(
  form: RuleFormState,
  t: (key: string) => string,
): { field: RuleField; message: string } | undefined {
  const value = Number(form.value);
  if (!Number.isFinite(value) || value <= 0) {
    return { field: 'value', message: t('discounts.form.errorValue') };
  }
  if (form.kind === 'PERCENT' && value > 100) {
    return { field: 'value', message: t('discounts.form.errorPercentRange') };
  }
  if (!form.allFeeTypes && form.feeTypes.length === 0) {
    return { field: 'feeTypes', message: t('discounts.form.errorFeeTypes') };
  }
  if (form.reason.trim().length < REASON_MIN_LENGTH) {
    return { field: 'reason', message: t('discounts.form.errorReason') };
  }
  if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) {
    return { field: 'dates', message: t('discounts.form.errorDateRange') };
  }
  return undefined;
}

function fieldError(
  error: { field: RuleField; message: string } | undefined,
  field: RuleField,
): React.ReactNode {
  return error?.field === field ? (
    <p role="alert" className="text-destructive">
      {error.message}
    </p>
  ) : null;
}

/**
 * `editingRule` is a mount-time-only prop, not something the caller flips
 * while this stays mounted — the caller unmounts/remounts (`{dialogOpen &&
 * ...}`, keyed by `editingRule?.id ?? 'add'`) whenever it changes, so
 * calling exactly one of `useCreateDiscountRule`/`useUpdateDiscountRule`
 * based on it doesn't break rules-of-hooks. Mounted only while `open` is
 * true — purely so the form resets between openings. (It is no longer
 * load-bearing for approval: the modal is owned by one app-level
 * `<ApprovalModalHostProvider>`, so several mounted `useApprovedMutation`
 * callers can no longer starve each other.)
 */
function RuleFormDialog({
  open,
  onOpenChange,
  studentId,
  editingRule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  editingRule: DiscountRule | null;
}) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const [form, setForm] = React.useState<RuleFormState>(() =>
    editingRule ? formFromRule(editingRule) : emptyForm(),
  );
  // Exactly one of these is called, not both — `editingRule` is fixed for
  // this component instance's whole lifetime (the caller keys/remounts on
  // it), so this doesn't break rules-of-hooks, and it means only one
  // `useApprovedMutation` call site is ever active here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mutation = editingRule ? useUpdateDiscountRule(studentId) : useCreateDiscountRule();

  const error = validate(form, t);

  function toggleFeeType(feeType: string, checked: boolean) {
    setForm((prev) => ({
      ...prev,
      feeTypes: checked ? [...prev.feeTypes, feeType] : prev.feeTypes.filter((f) => f !== feeType),
    }));
  }

  function handleSubmit() {
    if (error) return;
    const payload = {
      kind: form.kind,
      value: Number(form.value),
      fee_types: form.allFeeTypes ? null : form.feeTypes,
      starts_on: form.startsOn || null,
      ends_on: form.endsOn || null,
      reason: form.reason.trim(),
    };
    if (editingRule) {
      (mutation as ReturnType<typeof useUpdateDiscountRule>).mutate(
        { id: editingRule.id, ...payload },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      (mutation as ReturnType<typeof useCreateDiscountRule>).mutate(
        { student_id: studentId, ...payload },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
          <DialogHeader>
            <DialogTitle>
              {editingRule ? t('discounts.form.editTitle') : t('discounts.form.addTitle')}
            </DialogTitle>
            <DialogDescription>{t('discounts.form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('discounts.form.kindLabel')}</span>
              <RadioGroup
                value={form.kind}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, kind: value as DiscountKind }))
                }
                className="flex gap-4"
              >
                <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                  <RadioGroupItem value="PERCENT" id="discount-kind-percent" />
                  {t('discounts.form.kindPercent')}
                </label>
                <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                  <RadioGroupItem value="FLAT" id="discount-kind-flat" />
                  {t('discounts.form.kindFlat')}
                </label>
              </RadioGroup>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="discount-value" className="text-sm font-medium">
                {t('discounts.form.valueLabel')}
              </label>
              <Input
                id="discount-value"
                type="number"
                min={0}
                max={form.kind === 'PERCENT' ? 100 : undefined}
                value={form.value}
                inputMode="decimal"
                onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
              />
              {fieldError(error, 'value')}
            </div>

            <div className="grid gap-1.5">
              <label className="flex min-h-11 items-center gap-3 font-medium md:min-h-8">
                <Checkbox
                  id="discount-all-fee-types"
                  checked={form.allFeeTypes}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, allFeeTypes: checked === true }))
                  }
                />
                {t('discounts.form.allFeeTypes')}
              </label>
              {!form.allFeeTypes && (
                <div className="flex flex-wrap gap-3 pl-6">
                  {ALL_FEE_TYPES.map((feeType) => (
                    <label key={feeType} className="flex min-h-11 items-center gap-3 md:min-h-8">
                      <Checkbox
                        id={`discount-fee-type-${feeType}`}
                        checked={form.feeTypes.includes(feeType)}
                        onCheckedChange={(checked) => toggleFeeType(feeType, checked === true)}
                      />
                      {t(`feeType.${feeType}`, { ns: 'common', defaultValue: feeType })}
                    </label>
                  ))}
                </div>
              )}
              {fieldError(error, 'feeTypes')}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor="discount-starts-on" className="text-sm font-medium">
                  {t('discounts.form.startsOnLabel')}
                </label>
                <DatePicker
                  aria-label={t('discounts.form.startsOnLabel')}
                  config={regionConfig}
                  value={form.startsOn ? parseServerDate(form.startsOn) : undefined}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, startsOn: value ? toIsoDate(value) : '' }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="discount-ends-on" className="text-sm font-medium">
                  {t('discounts.form.endsOnLabel')}
                </label>
                <DatePicker
                  aria-label={t('discounts.form.endsOnLabel')}
                  config={regionConfig}
                  value={form.endsOn ? parseServerDate(form.endsOn) : undefined}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, endsOn: value ? toIsoDate(value) : '' }))
                  }
                />
              </div>
            </div>
            {fieldError(error, 'dates')}

            <div className="grid gap-1.5">
              <label htmlFor="discount-reason" className="text-sm font-medium">
                {t('discounts.form.reasonLabel')}
              </label>
              <Textarea
                id="discount-reason"
                value={form.reason}
                onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
                rows={3}
              />
              {fieldError(error, 'reason')}
            </div>

            {mutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('discounts.form.errorSave')}
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
              disabled={Boolean(error)}
              loading={mutation.isPending}
              onClick={handleSubmit}
            >
              {t('discounts.form.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Mounted only while a delete is in flight. Fires its mutation once on
 * mount rather than exposing an imperative handle, so the parent never
 * needs to hold a `useDeleteDiscountRule()` of its own.
 *
 * (It used to exist partly to avoid two `useApprovedMutation` instances
 * being mounted at once — that no longer matters: the approval modal is
 * owned by one app-level `<ApprovalModalHostProvider>`, so any number of
 * wrapped mutations can coexist. Keeping the component only for the
 * fire-once-on-mount ergonomics above.)
 */
function DeleteRuleAction({
  rule,
  studentId,
  onSuccess,
  onDismissError,
}: {
  rule: DiscountRule;
  studentId: string;
  onSuccess: () => void;
  onDismissError: () => void;
}) {
  const { t } = useTranslation('students');
  const deleteRule = useDeleteDiscountRule();
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    deleteRule.mutate({ id: rule.id, studentId }, { onSuccess: () => onSuccess() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once per mount
  }, []);

  // A failed delete used to be indistinguishable from a slow refresh --
  // `onSettled` cleared this component's mount trigger regardless of
  // success or failure, discarding `deleteRule.error` before the user
  // ever saw it. Stay mounted on failure so the error (and a way to
  // dismiss it and try again) is actually visible. The approval prompt
  // itself, if this delete needs one, comes from the app-level
  // `<ApprovalModalHostProvider>` -- nothing to render for that case.
  if (deleteRule.isError) {
    return (
      <div className="flex items-center gap-2">
        <MutationErrorMessage error={deleteRule.error} />
        <Button type="button" variant="ghost" onClick={onDismissError}>
          {t('discounts.dismissDeleteError')}
        </Button>
      </div>
    );
  }

  return null;
}

export function DiscountsSection({ studentId }: DiscountsSectionProps) {
  const { t } = useTranslation('students');
  const canManage = useHasPermission(Permission.DISCOUNT_RULE_MANAGE);
  const regionConfig = useRegionConfig();
  const rulesQuery = useDiscountRules(studentId);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<DiscountRule | null>(null);
  // `confirmingRule` is the "are you sure" step; `deletingRule` only gets
  // set (mounting `DeleteRuleAction`, which fires on mount) once that's
  // confirmed — an irreversible delete needs a step before the mutation
  // fires, not just the OTP modal, which only appears on a 403 and does
  // nothing once a step-up token is already cached.
  const [confirmingRule, setConfirmingRule] = React.useState<DiscountRule | null>(null);
  const [deletingRule, setDeletingRule] = React.useState<DiscountRule | null>(null);

  const valueOf = (rule: DiscountRule) =>
    rule.kind === 'PERCENT'
      ? `${formatNumber(rule.value, regionConfig)}%`
      : formatServerAmount(rule.value, regionConfig);
  const ruleSummary = (rule: DiscountRule) =>
    `${t(`discounts.form.kind${rule.kind === 'PERCENT' ? 'Percent' : 'Flat'}`)} ${valueOf(rule)} — ${rule.reason}`;

  function openAddDialog() {
    setEditingRule(null);
    setDialogOpen(true);
  }

  function openEditDialog(rule: DiscountRule) {
    setEditingRule(rule);
    setDialogOpen(true);
  }

  function handleDelete(rule: DiscountRule) {
    setConfirmingRule(rule);
  }

  function confirmDelete() {
    setDeletingRule(confirmingRule);
    setConfirmingRule(null);
  }

  const rules = rulesQuery.data ?? [];

  const columns: DataTableColumn<DiscountRule>[] = [
    {
      id: 'kind',
      header: t('discounts.columnKind'),
      accessorFn: (rule) => t(`discounts.form.kind${rule.kind === 'PERCENT' ? 'Percent' : 'Flat'}`),
      card: 'title',
    },
    {
      id: 'value',
      header: t('discounts.columnValue'),
      align: 'end',
      accessorFn: (rule) => valueOf(rule),
    },
    {
      id: 'feeTypes',
      header: t('discounts.columnFeeTypes'),
      accessorFn: (rule) =>
        rule.fee_types === null
          ? t('discounts.form.allFeeTypes')
          : rule.fee_types
              .map((type) => t(`feeType.${type}`, { ns: 'common', defaultValue: type }))
              .join(', '),
    },
    {
      id: 'range',
      header: t('discounts.columnRange'),
      accessorFn: (rule) =>
        rule.starts_on && rule.ends_on
          ? formatDateRange(rule.starts_on, rule.ends_on, regionConfig)
          : rule.starts_on
            ? t('discounts.fromDate', { date: formatDate(rule.starts_on, regionConfig) })
            : '—',
    },
    { id: 'reason', header: t('discounts.columnReason'), accessorFn: (rule) => rule.reason },
  ];

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex items-center justify-end">
          <Button type="button" variant="outline" onClick={openAddDialog}>
            <PlusIcon className="size-4" aria-hidden />
            {t('discounts.addRule')}
          </Button>
        </div>
      )}

      {rulesQuery.isPending ? (
        <SkeletonTable rows={3} columns={5} />
      ) : rulesQuery.isError ? (
        <ErrorState
          message={t('discounts.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<PercentIcon aria-hidden="true" />}
          title={t('discounts.emptyMessage')}
          explanation={t('discounts.emptyExplanation')}
        />
      ) : (
        <DataTable
          tableId="student-discount-rules"
          caption={t('detail.fees.discountsTab')}
          paginated={false}
          sorting={null}
          onSortingChange={() => {}}
          columns={columns}
          data={rules}
          getRowId={(rule) => rule.id}
          totalCount={rules.length}
          rowActions={(rule) => [
            {
              intent: 'edit',
              label: t('discounts.edit'),
              onClick: () => openEditDialog(rule),
              allowed: canManage,
            },
            {
              intent: 'delete',
              label: t('discounts.delete'),
              onClick: () => handleDelete(rule),
              allowed: canManage,
            },
          ]}
        />
      )}

      {canManage && dialogOpen && (
        <RuleFormDialog
          key={editingRule?.id ?? 'add'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          studentId={studentId}
          editingRule={editingRule}
        />
      )}
      {canManage && confirmingRule && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirmingRule(null)}
          tone="danger"
          title={t('discounts.deleteConfirmTitle')}
          description={t('discounts.deleteConfirmDescriptionNamed', {
            rule: ruleSummary(confirmingRule),
          })}
          confirmLabel={t('discounts.delete')}
          onConfirm={confirmDelete}
        />
      )}
      {canManage && deletingRule && (
        <DeleteRuleAction
          key={deletingRule.id}
          rule={deletingRule}
          studentId={studentId}
          onSuccess={() => setDeletingRule(null)}
          onDismissError={() => setDeletingRule(null)}
        />
      )}
    </div>
  );
}
