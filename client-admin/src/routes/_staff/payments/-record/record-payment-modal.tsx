/**
 * [16.4.4] Replaces the six-step Record Payment wizard with one POS-style
 * full page (`FullPageShell`, [31.4]): pick student(s), let the cart's oldest-first suggestion (or a
 * manual edit) allocate the amount received, take tender, submit once
 * through `POST /payments/checkout`.
 *
 * `useApprovedMutation(checkoutRequest, { approvalScope: ... })` — not
 * `{ scope }` — per the published plan's correction
 * (`ui/src/hooks/approval.tsx:96-109` reserves `scope` for TanStack
 * Query's own mutation-concurrency option). The approval prompt itself is
 * rendered by the app-level `<ApprovalModalHostProvider>` in
 * `routes/_staff.tsx` — this component renders nothing for it.
 *
 * `useCart`/`useCheckout` are backed by hand-written interim types in
 * `ui/src/hooks/payments.ts` — #658/#659's cart and checkout endpoints
 * are being built in a sibling wave-4 lane and aren't in `schema.d.ts`
 * yet. See that file's own header comment for the reconciliation seam.
 */
import { PaymentMethod } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  Input,
  Label,
  MoneyInput,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Textarea,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  studentKeys,
  useCart,
  useCheckout,
  useDebouncedValue,
  useGuardian,
  useStudentSearch,
  type CartBill,
  type ChangeHandling,
  type CheckoutResult,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import {
  formatCurrency,
  formatNumber,
  minorUnitsToDecimalString,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Search, X } from 'lucide-react';
import * as React from 'react';

import { CartTable, type CartLineState } from './cart-table';
import { CheckoutSuccess } from './checkout-success';
import { optionRowClass } from './option-row';
import { TenderSection } from './tender-section';

// Cash first, then the mobile wallets, then bank rails (the order a counter sees them).
const PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
  PaymentMethod.ROCKET,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CHEQUE,
  PaymentMethod.CARD,
];

const CARD_CLASS = 'rounded-lg border border-border-subtle bg-surface shadow-e1';
const MAX_STUDENTS = 10;

export interface RecordPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected student; the search box is hidden when present. */
  studentId?: string;
  /** Guardian entry point: every linked child starts selected. */
  guardianId?: string;
}

interface SelectedStudent {
  id: string;
  full_name: string;
}

export function RecordPaymentModal({
  open,
  onOpenChange,
  studentId,
  guardianId,
}: RecordPaymentModalProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchId = React.useId();
  const amountId = React.useId();
  const referenceId = React.useId();
  const remarksId = React.useId();
  const methodLegendId = React.useId();
  const formRef = React.useRef<HTMLFormElement>(null);

  const [selected, setSelected] = React.useState<SelectedStudent[]>([]);
  const [search, setSearch] = React.useState('');
  // The seeded student (deep link / guardian entry) is not "typed data";
  // only a hand-made add/remove makes the student step count as dirty.
  const [studentsEdited, setStudentsEdited] = React.useState(false);
  // `linesTouched` resets when the amount changes; this one stays set for any hand edit.
  const [linesEdited, setLinesEdited] = React.useState(false);
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const [amountReceivedMinorUnits, setAmountReceivedMinorUnits] = React.useState<
    number | undefined
  >(undefined);
  // F15: debounced the same way `search` is above — every keystroke in
  // "Amount received" would otherwise change `useCart`'s query key and
  // fire a full cart re-fetch per digit.
  const debouncedAmountReceivedMinorUnits = useDebouncedValue(amountReceivedMinorUnits, 300);
  const [lines, setLines] = React.useState<Map<string, CartLineState>>(new Map());
  const [linesTouched, setLinesTouched] = React.useState(false);
  const [walletUseMinorUnits, setWalletUseMinorUnits] = React.useState(0);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(PaymentMethod.CASH);
  const [transactionReference, setTransactionReference] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [tenderedMinorUnits, setTenderedMinorUnits] = React.useState<number | undefined>(undefined);
  const [changeHandling, setChangeHandling] = React.useState<ChangeHandling>('RETURN');
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  // [16.5.5]: `null` renders the checkout form; a `CheckoutResult` renders
  // `CheckoutSuccess` instead, in the same `DialogContent`.
  const [success, setSuccess] = React.useState<CheckoutResult | null>(null);

  const selectedStudentIds = React.useMemo(() => selected.map((s) => s.id), [selected]);

  // F3: seed on the `open` transition itself, not just on `studentId`/
  // guardian-data identity — those don't change on re-open after
  // `resetAndClose()` clears `selected`, so re-opening the modal from a
  // Payments tab used to leave no student selected.
  const guardianQuery = useGuardian(guardianId);

  // Starts `true` when the modal is already open at mount (every test in
  // this file, and any deep link that opens it pre-mounted) so the seed
  // below still runs on first render, same as the original mount-time
  // effect. Flips back to `true` on a later open->close->open cycle so
  // reopening the modal from a Payments tab seeds again — `resetAndClose`
  // clears `selected`, so `studentId`/`guardianQuery.data` not changing
  // identity on reopen (F3) no longer means nothing needs seeding.
  const [needsSeed, setNeedsSeed] = React.useState(open);
  const wasOpenRef = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpenRef.current) setNeedsSeed(true);
    wasOpenRef.current = open;
  }, [open]);

  // Seed selection from `studentId` (deep-linked from a Payments tab or
  // the students list) or from every linked child once the guardian
  // resolves. Guarded by `needsSeed` (cleared once seeded) rather than
  // just "nothing picked yet" (F3) — that guard alone doesn't fire again
  // on reopen since `studentId`/`guardianQuery.data` don't change identity.
  React.useEffect(() => {
    if (!needsSeed || selected.length > 0) return;
    if (studentId !== undefined) {
      setSelected([{ id: studentId, full_name: '' }]);
      setNeedsSeed(false);
    } else if (guardianQuery.data !== undefined) {
      setSelected(
        guardianQuery.data.students.map((student) => ({
          id: student.id,
          full_name: student.full_name,
        })),
      );
      setNeedsSeed(false);
    }
  }, [needsSeed, selected.length, studentId, guardianQuery.data]);

  const searchQuery = useStudentSearch(
    { search: debouncedSearch },
    { enabled: debouncedSearch.trim() !== '' && studentId === undefined },
  );

  const cart = useCart({
    studentIds: selectedStudentIds,
    config,
    ...(debouncedAmountReceivedMinorUnits !== undefined
      ? { amount: debouncedAmountReceivedMinorUnits }
      : {}),
  });
  // F4: `useCart`'s `placeholderData: keepPreviousData` keeps the PREVIOUS
  // selection's cart on screen while a new one is in flight — submitting
  // during that window would post the stale selection's `student_fee_id`s
  // against the new selection, misallocating money to the wrong student.
  const cartIsFresh = !cart.isPlaceholderData && !cart.isFetching;

  // F14: the `linesTouched` guard must only block a stale BACKGROUND
  // refetch from clobbering a manual edit — not the accountant's own
  // re-entry into "Amount received" (an explicit request to redistribute)
  // and not a newly-added student/sibling, whose lines have never been
  // seeded. `forceReseedAll` covers "nothing has been touched yet" and
  // "the amount just changed"; `newStudentIds` covers a sibling added
  // after other lines were already hand-edited.
  const prevAmountRef = React.useRef(debouncedAmountReceivedMinorUnits);
  const prevStudentIdsRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    // Skip the placeholder (the previous key's cart, shown while the new
    // one loads) and do NOT advance the refs below: reseeding from it saw
    // "amount changed" with no `suggested` block, zeroed every line and
    // cleared `linesTouched`, so a discount typed while the new cart was in
    // flight was wiped. The real response is what should count as the change.
    if (cart.data === undefined || cart.isPlaceholderData) return;

    const amountChanged = prevAmountRef.current !== debouncedAmountReceivedMinorUnits;
    const newStudentIds = selectedStudentIds.filter(
      (id) => !prevStudentIdsRef.current.includes(id),
    );
    prevAmountRef.current = debouncedAmountReceivedMinorUnits;
    prevStudentIdsRef.current = selectedStudentIds;

    const forceReseedAll = !linesTouched || amountChanged;
    if (!forceReseedAll && newStudentIds.length === 0) return;

    // `GET /payments/cart`'s `suggested` block is only present when the
    // request carried an `amount` (`checkout.dto.ts`'s own comment on
    // `QueryCheckoutCartDto.amount`: "Omitted → no suggested block") — the
    // modal opens with no amount typed yet (`debouncedAmountReceivedMinor
    // Units` starts `undefined`), so this effect's first run always sees
    // `cart.data.suggested === undefined` and must not assume otherwise.
    // Every component test's own `cartResponse()` mock always includes
    // `suggested`, which is why this crash-on-open only showed up against
    // the real server (`e2e/journeys/checkout.spec.ts`).
    const suggestions = new Map(
      (cart.data.suggested?.allocations ?? []).map((allocation) => [
        allocation.student_fee_id,
        allocation.amount,
      ]),
    );

    const cartData = cart.data;
    setLines((prev) => {
      const next = new Map(prev);
      for (const student of cartData.students) {
        for (const bill of student.bills) {
          if (
            !forceReseedAll &&
            !newStudentIds.includes(student.id) &&
            prev.has(bill.student_fee_id)
          ) {
            continue;
          }
          const suggested = suggestions.get(bill.student_fee_id);
          const discountMinorUnits = prev.get(bill.student_fee_id)?.discountMinorUnits ?? 0;
          const balanceMinorUnits = serverAmountToMinorUnits(bill.balance, config);
          const suggestedPayMinorUnits =
            suggested !== undefined ? serverAmountToMinorUnits(suggested, config) : 0;
          next.set(bill.student_fee_id, {
            // The server's suggestion doesn't know about a discount typed
            // locally — cap it so Pay + discount never exceeds the balance
            // (the same rule `DiscountCell.commit` enforces the other way).
            payMinorUnits: Math.max(
              0,
              Math.min(suggestedPayMinorUnits, balanceMinorUnits - discountMinorUnits),
            ),
            // A discount is a waiver, not part of how the cash is split, so a
            // new amount re-suggests Pay but keeps the discount typed.
            discountMinorUnits,
          });
        }
      }
      return next;
    });

    if (amountChanged) setLinesTouched(false);
  }, [
    cart.data,
    cart.isPlaceholderData,
    debouncedAmountReceivedMinorUnits,
    selectedStudentIds,
    linesTouched,
    config,
  ]);

  const checkout = useCheckout();

  function handleLineChange(studentFeeId: string, patch: Partial<CartLineState>) {
    setLinesTouched(true);
    setLinesEdited(true);
    setLines((prev) => {
      const next = new Map(prev);
      const current = next.get(studentFeeId) ?? { payMinorUnits: 0, discountMinorUnits: 0 };
      next.set(studentFeeId, { ...current, ...patch });
      return next;
    });
  }

  function addStudent(student: SelectedStudent) {
    if (selected.length >= MAX_STUDENTS) return;
    if (selected.some((existing) => existing.id === student.id)) return;
    setSelected((prev) => [...prev, student]);
    setStudentsEdited(true);
    setSearch('');
  }

  function removeStudent(id: string) {
    setStudentsEdited(true);
    setSelected((prev) => prev.filter((student) => student.id !== id));
    // Drop their lines too: a kept line would bring an old Pay/discount back
    // if the student is re-added, and keep the approval hint on meanwhile.
    const feeIds =
      cart.data?.students
        .find((student) => student.id === id)
        ?.bills.map((b) => b.student_fee_id) ?? [];
    setLines((prev) => {
      const next = new Map(prev);
      for (const feeId of feeIds) next.delete(feeId);
      return next;
    });
  }

  const allBills: CartBill[] = React.useMemo(
    () => cart.data?.students.flatMap((student) => student.bills) ?? [],
    [cart.data],
  );

  // F10/F13: computed once here, from the same `lines`/`allBills` data
  // `canSubmit` reads, and handed down instead of letting `DiscountCell`
  // or a shared callback recompute (and potentially disagree).
  const lineValidity = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const bill of allBills) {
      const balanceMinorUnits = serverAmountToMinorUnits(bill.balance, config);
      const line = lines.get(bill.student_fee_id) ?? { payMinorUnits: 0, discountMinorUnits: 0 };
      map.set(
        bill.student_fee_id,
        line.payMinorUnits + line.discountMinorUnits <= balanceMinorUnits,
      );
    }
    return map;
  }, [allBills, lines, config]);
  const allLinesValid = [...lineValidity.values()].every(Boolean);

  // F13: derived from `lines` itself (some bill has a discount) rather
  // than each `DiscountCell` reporting its own boolean up through a
  // shared setter, which the last cell to fire would clobber.
  const requiresApproval = [...lines.values()].some((line) => line.discountMinorUnits > 0);

  const subtotalMinorUnits = allBills.reduce(
    (sum, bill) => sum + (lines.get(bill.student_fee_id)?.payMinorUnits ?? 0),
    0,
  );
  // F9 (deliberately left untouched — cross-lane, pending reconciliation
  // with #659): this sums every selected student's own `wallet_balance`
  // into one pool and lets `wallet_use` draw against the pool as a whole.
  // Whether #659's checkout contract actually allows one student's wallet
  // credit to pay down a SIBLING's bill (rather than each student's
  // wallet only covering their own lines) is an open cross-lane question
  // for #659, not something to guess at here.
  const walletBalanceMinorUnits = (cart.data?.students ?? []).reduce(
    (sum, student) => sum + serverAmountToMinorUnits(student.wallet_balance, config),
    0,
  );
  const cappedWalletUseMinorUnits = Math.min(
    walletUseMinorUnits,
    walletBalanceMinorUnits,
    subtotalMinorUnits,
  );
  const amountDueMinorUnits = Math.max(0, subtotalMinorUnits - cappedWalletUseMinorUnits);

  // F12: a bill can be fully covered by pay + discount with `pay` itself
  // at 0 ("discount the rest" after clearing Pay) — a legitimate 100%
  // write-off. `subtotalMinorUnits` alone (sum of `payMinorUnits`) can't
  // see that allocation, so `canSubmit` must not gate on it being > 0.
  const touchedLines = React.useMemo(
    () =>
      allBills
        .map((bill) => ({ bill, line: lines.get(bill.student_fee_id) }))
        .filter(
          ({ line }) =>
            line !== undefined && (line.payMinorUnits > 0 || line.discountMinorUnits > 0),
        ),
    [allBills, lines],
  );

  /** Everything `resetAndClose()` used to do, minus closing the dialog —
   * [16.5.5] needs this split so "Record another" (from the success view)
   * can clear the form for a new checkout without also closing the
   * `Dialog`. */
  function resetForm() {
    setSelected([]);
    setSearch('');
    setStudentsEdited(false);
    setLinesEdited(false);
    setNeedsSeed(Boolean(studentId));
    setAmountReceivedMinorUnits(undefined);
    setLines(new Map());
    setLinesTouched(false);
    setWalletUseMinorUnits(0);
    setPaymentMethod(PaymentMethod.CASH);
    setTransactionReference('');
    setRemarks('');
    setTenderedMinorUnits(undefined);
    setChangeHandling('RETURN');
    setIdempotencyKey(crypto.randomUUID());
    // A stale failure from the last attempt must not greet the next one.
    checkout.reset();
  }

  function resetAndClose() {
    resetForm();
    setSuccess(null);
    onOpenChange(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!canSubmit) return;

    const notifyTenantId = captureNotificationTenant();

    checkout.mutate(
      {
        idempotency_key: idempotencyKey,
        lines: touchedLines.map(({ bill, line }) => ({
          student_fee_id: bill.student_fee_id,
          amount: Number(minorUnitsToDecimalString(line?.payMinorUnits ?? 0, config)),
          one_off_discount: Number(
            minorUnitsToDecimalString(line?.discountMinorUnits ?? 0, config),
          ),
        })),
        payment_method: paymentMethod,
        ...(transactionReference.trim() !== ''
          ? { transaction_reference: transactionReference.trim() }
          : {}),
        ...(remarks.trim() !== '' ? { remarks: remarks.trim() } : {}),
        ...(paymentMethod === PaymentMethod.CASH && tenderedMinorUnits !== undefined
          ? { tendered_amount: Number(minorUnitsToDecimalString(tenderedMinorUnits, config)) }
          : {}),
        ...(cappedWalletUseMinorUnits > 0
          ? { wallet_use: Number(minorUnitsToDecimalString(cappedWalletUseMinorUnits, config)) }
          : {}),
        change_handling: changeHandling,
      },
      {
        onSuccess: (result) => {
          const changeMessage =
            result.change_amount > 0
              ? t('record.notifications.recordedWithChange', {
                  amount: formatCurrency(subtotalMinorUnits, config),
                  change: formatCurrency(
                    serverAmountToMinorUnits(result.change_amount, config),
                    config,
                  ),
                })
              : t('record.notifications.recorded', {
                  amount: formatCurrency(subtotalMinorUnits, config),
                });
          notifyOutcome({ tenantId: notifyTenantId, variant: 'success', message: changeMessage });
          // F17: per-student cached data (fees tab, payments tab, wallet
          // balance) is now stale — the old `useCreatePayment` invalidated
          // `studentKeys.detail(id)` for this reason; this checkout hook
          // has no student id on `CheckoutLine` to loop over itself, so
          // the modal (which does have `selectedStudentIds`) does it here.
          for (const id of selectedStudentIds) {
            void queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) });
          }
          setSuccess(result);
        },
        onError: (error) => {
          if (error instanceof ApprovalCancelledError) return;
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'error',
            message: t('record.notifications.failed'),
          });
        },
      },
    );
  }

  const canSubmit =
    selectedStudentIds.length > 0 &&
    // F12: "some line has real allocation" (pay or discount), not
    // `subtotalMinorUnits > 0` — a fully-discounted line contributes 0 to
    // the pay-only subtotal but is still a legitimate submission.
    touchedLines.length > 0 &&
    // F10: every line's `pay + discount ≤ balance`, re-checked here
    // (not just at the moment a discount was set) so raising Pay
    // afterwards can't silently escape `DiscountCell`'s own clamp.
    allLinesValid &&
    // F4: never submit while `useCart`'s `placeholderData` is standing in
    // for the current selection, or a stale selection's `student_fee_id`s
    // get posted against the new one.
    cartIsFresh &&
    !checkout.isPending &&
    (paymentMethod !== PaymentMethod.CASH ||
      tenderedMinorUnits === undefined ||
      cappedWalletUseMinorUnits + tenderedMinorUnits >= subtotalMinorUnits);

  const cartStudentsById = new Map((cart.data?.students ?? []).map((s) => [s.id, s]));
  const dirty =
    studentsEdited ||
    amountReceivedMinorUnits !== undefined ||
    linesEdited ||
    paymentMethod !== PaymentMethod.CASH ||
    walletUseMinorUnits > 0 ||
    changeHandling !== 'RETURN' ||
    tenderedMinorUnits !== undefined ||
    transactionReference !== '' ||
    remarks !== '';

  if (!open) return null;

  if (success !== null) {
    return (
      <FullPageShell
        title={t('record.success.title')}
        size="wide"
        onClose={resetAndClose}
        primary={{
          label: t('record.success.recordAnother'),
          onClick: () => {
            resetForm();
            setSuccess(null);
          },
        }}
        secondary={{
          label: t('record.success.viewInvoice'),
          onClick: () => {
            // On the record page, replace: Back from the invoice should skip this finished form. Host screens keep their page in history.
            void navigate({
              to: '/invoices/$invoiceId',
              params: { invoiceId: success.invoice_id },
              // Read from the router at click time (no re-render subscription for one click).
              replace: router.state.location.pathname === '/payments/record',
            });
          },
        }}
      >
        <CheckoutSuccess result={success} studentIds={selectedStudentIds} />
      </FullPageShell>
    );
  }

  return (
    <FullPageShell
      title={t('record.title')}
      size="wide"
      dirty={dirty}
      onClose={resetAndClose}
      secondary={{
        label: t('record.cancel'),
        // Same discard confirm as header Close / Esc (the shell only guards those two).
        onClick: () => (dirty ? setConfirmingCancel(true) : resetAndClose()),
      }}
      primary={{
        label:
          subtotalMinorUnits > 0
            ? t('record.submitWithAmount', { amount: formatCurrency(subtotalMinorUnits, config) })
            : t('record.submitAction'),
        onClick: () => formRef.current?.requestSubmit(),
        busy: checkout.isPending,
        disabled: !canSubmit,
      }}
    >
      <form ref={formRef} className="space-y-6" onSubmit={handleSubmit}>
        <section className={`${CARD_CLASS} flex flex-col gap-3 p-4 md:p-5`}>
          <div>
            <h2 className="text-h3">{t('record.sections.students')}</h2>
            <p className="text-text-secondary">{t('record.sections.studentsHelp')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.map((student) => {
              const info = cartStudentsById.get(student.id);
              const name = student.full_name || info?.full_name || '';
              return (
                <span
                  key={student.id}
                  className="flex h-11 items-center gap-1 rounded-full border border-border bg-accent ps-3 pe-1 text-sm md:h-8"
                >
                  {name === '' ? (
                    // Never the id (D9): hold the chip's place until the cart names the student.
                    <Skeleton className="h-4 w-32 rounded-full" />
                  ) : info ? (
                    t('record.students.chip', {
                      name,
                      className: info.class_name,
                      sectionName: info.section_name,
                    })
                  ) : (
                    name
                  )}
                  {studentId === undefined && name !== '' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      iconOnly
                      className="size-11 md:size-8"
                      aria-label={t('record.students.removeStudent', { name })}
                      onClick={() => removeStudent(student.id)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </span>
              );
            })}
          </div>

          {studentId === undefined && (
            <div className="flex flex-col gap-1.5 md:w-1/2">
              <Label htmlFor={searchId}>
                {selected.length > 0
                  ? t('record.students.addAnotherLabel')
                  : t('record.students.searchLabel')}
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                  aria-hidden="true"
                />
                <Input
                  id={searchId}
                  className="ps-9"
                  placeholder={t('record.students.searchPlaceholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={selected.length >= MAX_STUDENTS}
                />
              </div>
              {selected.length >= MAX_STUDENTS && (
                <p className="text-label text-text-secondary">{t('record.students.maxReached')}</p>
              )}
              {debouncedSearch.trim() !== '' && (
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto" aria-live="polite">
                  {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
                    <li className="text-sm text-text-secondary">
                      {t('record.students.noResults')}
                    </li>
                  )}
                  {searchQuery.data?.data.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-start text-sm hover:bg-accent md:min-h-8"
                        onClick={() => addStudent({ id: result.id, full_name: result.full_name })}
                      >
                        <span>{result.full_name}</span>
                        <span className="text-text-secondary">
                          {t('record.students.rollAndClass', {
                            roll: formatNumber(result.roll_number, config),
                            className: result.class_section.class.name,
                            sectionName: result.class_section.section_name,
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {guardianId !== undefined &&
            guardianQuery.data !== undefined &&
            guardianQuery.data.students.some(
              (student) => !selectedStudentIds.includes(student.id),
            ) && (
              <Button
                type="button"
                variant="outline"
                className="h-11 self-start md:h-8"
                disabled={selected.length >= MAX_STUDENTS}
                title={
                  selected.length >= MAX_STUDENTS ? t('record.students.maxReached') : undefined
                }
                onClick={() => {
                  const next = guardianQuery.data?.students.find(
                    (student) => !selectedStudentIds.includes(student.id),
                  );
                  if (next) addStudent({ id: next.id, full_name: next.full_name });
                }}
              >
                {t('record.students.addSibling')}
              </Button>
            )}
        </section>

        <section className={`${CARD_CLASS} overflow-hidden`}>
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between md:p-5">
            <div>
              <h2 className="text-h3">{t('record.sections.bills')}</h2>
              <p className="text-text-secondary">{t('record.sections.billsHelp')}</p>
            </div>
            <div className="flex flex-col gap-1.5 md:w-56">
              <Label htmlFor={amountId}>{t('record.amountReceived.label')}</Label>
              <MoneyInput
                id={amountId}
                config={config}
                value={amountReceivedMinorUnits}
                onValueChange={setAmountReceivedMinorUnits}
              />
            </div>
          </div>

          {/* F7: a failed or still-loading `/payments/cart` fetch used to be
              indistinguishable from "no open bills" — surface both states
              explicitly instead of silently rendering an empty cart. */}
          {selectedStudentIds.length > 0 && cart.isPending ? (
            <div className="flex flex-col gap-2 p-4 md:px-5" aria-live="polite">
              <span className="text-text-secondary">{t('record.cart.loading')}</span>
              <Skeleton className="h-32 w-full" />
            </div>
          ) : cart.isError ? (
            <div className="p-4 md:px-5">
              <ErrorState message={t('record.cart.error')} onRetry={() => void cart.refetch()} />
            </div>
          ) : selectedStudentIds.length === 0 ? (
            <p className="p-4 pt-0 text-text-secondary md:px-5">{t('record.cart.pickStudent')}</p>
          ) : (
            <CartTable
              students={cart.data?.students ?? []}
              lines={lines}
              onLineChange={handleLineChange}
              lineValidity={lineValidity}
              config={config}
              subtotalMinorUnits={subtotalMinorUnits}
              walletBalanceMinorUnits={walletBalanceMinorUnits}
              walletUseMinorUnits={cappedWalletUseMinorUnits}
              onWalletUseChange={setWalletUseMinorUnits}
              amountDueMinorUnits={amountDueMinorUnits}
            />
          )}
        </section>

        <section className={`${CARD_CLASS} flex flex-col gap-4 p-4 md:p-5`}>
          <h2 className="text-h3">{t('record.sections.money')}</h2>

          <div className="flex flex-col gap-2">
            <span id={methodLegendId} className="text-sm font-medium">
              {t('record.method.label')}
            </span>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
              aria-labelledby={methodLegendId}
              className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
              {PAYMENT_METHODS.map((method) => (
                <label key={method} className={optionRowClass}>
                  <RadioGroupItem value={method} />
                  {t(`record.method.methods.${method}`)}
                </label>
              ))}
            </RadioGroup>
          </div>

          {paymentMethod === PaymentMethod.CASH && (
            <TenderSection
              config={config}
              tenderedMinorUnits={tenderedMinorUnits}
              onTenderedChange={setTenderedMinorUnits}
              walletUseMinorUnits={cappedWalletUseMinorUnits}
              subtotalMinorUnits={subtotalMinorUnits}
              changeHandling={changeHandling}
              onChangeHandlingChange={setChangeHandling}
            />
          )}

          {paymentMethod !== PaymentMethod.CASH && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={referenceId}>{t('record.method.referenceLabel')}</Label>
              <Input
                id={referenceId}
                value={transactionReference}
                onChange={(event) => setTransactionReference(event.target.value)}
                onKeyDown={(event) => {
                  // D17 — a barcode scanner's trailing Enter must never
                  // submit the form.
                  if (event.key === 'Enter') event.preventDefault();
                }}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={remarksId}>{t('record.method.remarksLabel')}</Label>
            <Textarea
              id={remarksId}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </div>

          {requiresApproval && (
            <p className="text-sm text-text-secondary">{t('record.discount.needsApproval')}</p>
          )}

          {/* F6: cancelling the approval step-up is a deliberate no-op, not
              a failure; F18 wires up the `approvalCancelled` copy for it. */}
          {checkout.error instanceof ApprovalCancelledError ? (
            <p className="text-sm text-text-secondary">
              {t('record.notifications.approvalCancelled')}
            </p>
          ) : (
            checkout.error !== null &&
            checkout.error !== undefined && (
              <p role="alert" className="text-sm text-destructive">
                {t('record.notifications.failed')}
              </p>
            )
          )}
        </section>
      </form>
      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        tone="danger"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setConfirmingCancel(false);
          resetAndClose();
        }}
      />
    </FullPageShell>
  );
}
