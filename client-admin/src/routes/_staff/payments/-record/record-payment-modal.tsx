/**
 * [16.4.4] Replaces the six-step Record Payment wizard with one POS-style
 * `Dialog`: pick student(s), let the cart's oldest-first suggestion (or a
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
import {
  ApiError,
  captureNotificationTenant,
  notifyOutcome,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
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
import {
  formatCurrency,
  minorUnitsToDecimalString,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import * as React from 'react';

import { CartTable, type CartLineState } from './cart-table';
import { CheckoutSuccess } from './checkout-success';
import { TenderSection } from './tender-section';

const PAYMENT_METHODS = Object.values(PaymentMethod);
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

function describeSubmitError(error: unknown, t: TFunction<'payments'>): string {
  if (error instanceof RateLimitedError) return t('record.notifications.failed');
  if (error instanceof ApiError) return error.message;
  return t('record.notifications.failed');
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
  const queryClient = useQueryClient();

  const [selected, setSelected] = React.useState<SelectedStudent[]>([]);
  const [search, setSearch] = React.useState('');
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
          next.set(bill.student_fee_id, {
            payMinorUnits:
              suggested !== undefined ? serverAmountToMinorUnits(suggested, config) : 0,
            // A discount is a waiver, not part of how the cash is split, so a
            // new amount re-suggests Pay but keeps the discount typed.
            discountMinorUnits: prev.get(bill.student_fee_id)?.discountMinorUnits ?? 0,
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
    setSearch('');
  }

  function removeStudent(id: string) {
    setSelected((prev) => prev.filter((student) => student.id !== id));
    // Drop their lines too: a kept line would bring an old Pay/discount back
    // if the student is re-added, and keep the approval hint on meanwhile.
    const feeIds =
      cart.data?.students.find((student) => student.id === id)?.bills.map((b) => b.student_fee_id) ??
      [];
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
  }

  function resetAndClose() {
    resetForm();
    setSuccess(null);
    onOpenChange(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (touchedLines.length === 0) return;

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

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-w-3xl">
        {success !== null ? (
          <CheckoutSuccess
            result={success}
            studentIds={selectedStudentIds}
            onRecordAnother={() => {
              resetForm();
              setSuccess(null);
            }}
            onViewInvoice={() => {
              onOpenChange(false);
              void navigate({
                to: '/invoices/$invoiceId',
                params: { invoiceId: success.invoice_id },
              });
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('record.title')}</DialogTitle>
              <DialogDescription>{t('record.description')}</DialogDescription>
            </DialogHeader>

            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('record.students.label')}</span>
                <div className="flex flex-wrap gap-2">
                  {selected.map((student) => (
                    <span
                      key={student.id}
                      className="flex items-center gap-1 rounded-full border border-border bg-accent px-3 py-1 text-sm"
                    >
                      {student.full_name || student.id}
                      {studentId === undefined && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          iconOnly
                          aria-label={t('record.students.removeStudent', {
                            name: student.full_name || student.id,
                          })}
                          onClick={() => removeStudent(student.id)}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  ))}
                </div>

                {studentId === undefined && (
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label={t('record.students.searchLabel')}
                      placeholder={t('record.students.searchPlaceholder')}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      disabled={selected.length >= MAX_STUDENTS}
                    />
                    {debouncedSearch.trim() !== '' && (
                      <ul
                        className="flex max-h-40 flex-col gap-1 overflow-y-auto"
                        aria-live="polite"
                      >
                        {searchQuery.isSuccess && searchQuery.data.data.length === 0 && (
                          <li className="text-sm text-muted-foreground">
                            {t('record.students.noResults')}
                          </li>
                        )}
                        {searchQuery.data?.data.map((result) => (
                          <li key={result.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-start text-sm hover:bg-accent"
                              onClick={() =>
                                addStudent({ id: result.id, full_name: result.full_name })
                              }
                            >
                              <span>{result.full_name}</span>
                              <span className="text-muted-foreground">
                                {t('record.students.rollAndClass', {
                                  roll: result.roll_number,
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
                      size="sm"
                      disabled={selected.length >= MAX_STUDENTS}
                      title={
                        selected.length >= MAX_STUDENTS
                          ? t('record.students.maxReached')
                          : undefined
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
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('record.amountReceived.label')}</span>
                <MoneyInput
                  aria-label={t('record.amountReceived.label')}
                  config={config}
                  value={amountReceivedMinorUnits}
                  onValueChange={setAmountReceivedMinorUnits}
                />
                <p className="text-xs text-muted-foreground">{t('record.amountReceived.hint')}</p>
              </div>

              {/* F7: a failed or still-loading `/payments/cart` fetch used to be
              indistinguishable from "no open bills" — surface both states
              explicitly instead of silently rendering an empty cart. */}
              {selectedStudentIds.length > 0 && cart.isPending ? (
                <div className="flex flex-col gap-2" aria-live="polite">
                  <span className="text-sm text-muted-foreground">{t('record.cart.loading')}</span>
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : cart.isError ? (
                <ErrorState message={t('record.cart.error')} onRetry={() => void cart.refetch()} />
              ) : selectedStudentIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('record.students.label')}</p>
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

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('record.method.label')}</span>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                  className="grid grid-cols-4 gap-2 sm:grid-cols-7"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <label
                      key={method}
                      className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-xs has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem value={method} />
                      {t(`record.method.methods.${method}`)}
                    </label>
                  ))}
                </RadioGroup>

                {paymentMethod !== PaymentMethod.CASH && (
                  <Input
                    aria-label={t('record.method.referenceLabel')}
                    placeholder={t('record.method.referenceLabel')}
                    value={transactionReference}
                    onChange={(event) => setTransactionReference(event.target.value)}
                    onKeyDown={(event) => {
                      // D17 — a barcode scanner's trailing Enter must never
                      // submit the form.
                      if (event.key === 'Enter') event.preventDefault();
                    }}
                  />
                )}

                <Textarea
                  aria-label={t('record.method.remarksLabel')}
                  placeholder={t('record.method.remarksLabel')}
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                />
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

              {requiresApproval && (
                <p className="text-sm text-muted-foreground">
                  {t('record.discount.needsApproval')}
                </p>
              )}

              {/* F6: cancelling the approval step-up is a deliberate no-op, not
              a failure — `onError` above already swallows it for the
              toast, but this inline alert used to unconditionally render
              `describeSubmitError` regardless of error type, showing a red
              "Recording payment failed" for a cancel. F18 wires up the
              `approvalCancelled` copy that was sitting unused for exactly
              this case. */}
              {checkout.error instanceof ApprovalCancelledError ? (
                <p className="text-sm text-muted-foreground">
                  {t('record.notifications.approvalCancelled')}
                </p>
              ) : (
                checkout.error !== null &&
                checkout.error !== undefined && (
                  <p role="alert" className="text-sm text-destructive">
                    {describeSubmitError(checkout.error, t)}
                  </p>
                )
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={resetAndClose}>
                  {t('record.cancel')}
                </Button>
                <Button type="submit" disabled={!canSubmit} loading={checkout.isPending}>
                  {t('record.submitAction')}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
