/**
 * [16.7.6] "Discounts" section of the student's Fees tab — one student's
 * standing discount rules (D8), add/edit/delete through the approval-gated
 * mutation shape `-reverse-payment-dialog.tsx` (16.6.2, wave 6) already
 * established: `useApprovedMutation` renders its own `modal` anywhere in
 * this component's tree, so a plain 403 becomes a step-up prompt with no
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
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
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

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
 * payment dialog enforces for the same "explain yourself" reason. */
function validate(form: RuleFormState, t: (key: string) => string): string | undefined {
  const value = Number(form.value);
  if (!Number.isFinite(value) || value <= 0) return t('discounts.form.errorValue');
  if (form.kind === 'PERCENT' && value > 100) return t('discounts.form.errorPercentRange');
  if (!form.allFeeTypes && form.feeTypes.length === 0) return t('discounts.form.errorFeeTypes');
  if (form.reason.trim().length < REASON_MIN_LENGTH) return t('discounts.form.errorReason');
  if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) {
    return t('discounts.form.errorDateRange');
  }
  return undefined;
}

/**
 * `editingRule` is a mount-time-only prop, not something the caller flips
 * while this stays mounted — the caller unmounts/remounts (`{dialogOpen &&
 * ...}`, keyed by `editingRule?.id ?? 'add'`) whenever it changes, so
 * calling exactly one of `useCreateDiscountRule`/`useUpdateDiscountRule`
 * based on it doesn't break rules-of-hooks. Mounted only while `open` is
 * true, same reasoning `-reverse-payment-dialog.tsx`'s own comment gives:
 * `useApprovedMutation`'s single modal host goes to whichever instance
 * mounts first and keeps it forever, so an always-mounted dialog here
 * would starve the delete action's own approval modal (see
 * `DeleteRuleAction` below).
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
        <DialogContent>
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
                <label className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="PERCENT" id="discount-kind-percent" />
                  {t('discounts.form.kindPercent')}
                </label>
                <label className="flex items-center gap-1.5 text-sm">
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
                onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <label className="flex items-center gap-2 text-sm font-medium">
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
                    <label key={feeType} className="flex items-center gap-1.5 text-sm">
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="discount-starts-on" className="text-sm font-medium">
                  {t('discounts.form.startsOnLabel')}
                </label>
                <Input
                  id="discount-starts-on"
                  type="date"
                  value={form.startsOn}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, startsOn: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="discount-ends-on" className="text-sm font-medium">
                  {t('discounts.form.endsOnLabel')}
                </label>
                <Input
                  id="discount-ends-on"
                  type="date"
                  value={form.endsOn}
                  onChange={(event) => setForm((prev) => ({ ...prev, endsOn: event.target.value }))}
                />
              </div>
            </div>

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
      {mutation.modal}
    </>
  );
}

/**
 * Mounted only while a delete is in flight — same "one approved-mutation
 * host at a time" reasoning `RuleFormDialog` and `-reverse-payment-
 * dialog.tsx` both document. Fires its mutation once on mount rather than
 * exposing an imperative handle, so the parent never needs to hold a
 * `useDeleteDiscountRule()` of its own (which would otherwise stay mounted
 * for the whole section and starve the add/edit dialog's modal).
 */
function DeleteRuleAction({
  rule,
  studentId,
  onSettled,
}: {
  rule: DiscountRule;
  studentId: string;
  onSettled: () => void;
}) {
  const deleteRule = useDeleteDiscountRule();
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    deleteRule.mutate({ id: rule.id, studentId }, { onSettled: () => onSettled() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once per mount
  }, []);

  return deleteRule.modal;
}

export function DiscountsSection({ studentId }: DiscountsSectionProps) {
  const { t } = useTranslation('students');
  const canManage = useHasPermission(Permission.DISCOUNT_RULE_MANAGE);
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

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={openAddDialog}>
            {t('discounts.addRule')}
          </Button>
        </div>
      )}

      {rulesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t('discounts.loading')}</p>
      ) : rulesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('discounts.errorMessage')}
        </p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('discounts.emptyMessage')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('discounts.columnKind')}</TableHead>
              <TableHead>{t('discounts.columnValue')}</TableHead>
              <TableHead>{t('discounts.columnFeeTypes')}</TableHead>
              <TableHead>{t('discounts.columnRange')}</TableHead>
              <TableHead>{t('discounts.columnReason')}</TableHead>
              {canManage && <TableHead>{t('discounts.columnActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  {t(`discounts.form.kind${rule.kind === 'PERCENT' ? 'Percent' : 'Flat'}`)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {rule.kind === 'PERCENT' ? `${rule.value}%` : rule.value}
                </TableCell>
                <TableCell>
                  {rule.fee_types === null
                    ? t('discounts.form.allFeeTypes')
                    : rule.fee_types
                        .map((type) => t(`feeType.${type}`, { ns: 'common', defaultValue: type }))
                        .join(', ')}
                </TableCell>
                <TableCell>
                  {rule.starts_on ?? '—'} – {rule.ends_on ?? '—'}
                </TableCell>
                <TableCell>{rule.reason}</TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEditDialog(rule)}
                      >
                        {t('discounts.edit')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        loading={deletingRule?.id === rule.id}
                        onClick={() => handleDelete(rule)}
                      >
                        {t('discounts.delete')}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
        <Dialog open onOpenChange={(next) => !next && setConfirmingRule(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('discounts.deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('discounts.deleteConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('actions.cancel', { ns: 'common' })}
                </Button>
              </DialogClose>
              <Button type="button" variant="destructive" onClick={confirmDelete}>
                {t('discounts.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canManage && deletingRule && (
        <DeleteRuleAction
          key={deletingRule.id}
          rule={deletingRule}
          studentId={studentId}
          onSettled={() => setDeletingRule(null)}
        />
      )}
    </div>
  );
}
