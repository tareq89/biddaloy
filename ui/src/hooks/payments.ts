import { ApprovalScope, type PaymentMethod } from '@biddaloy/shared';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import type { RegionConfig } from '../i18n';
import { minorUnitsToDecimalString } from '../utils';

import { type ApprovedMutationResult, useApprovedMutation } from './approval';
import { feeDuesKeys } from './fee-dues';
import { invoiceKeys } from './invoices';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { walletKeys } from './wallet';

export type Payment = components['schemas']['Payment'];
export type IssuerSnapshot = components['schemas']['IssuerSnapshot'];
/** [16.6.2] `GET /payments/:id` — full staff-only detail row (allocations,
 * invoice link, collector/approver, reversal linkage). Already a published
 * schema type (`fees.controller.ts:330`/`payments-query.service.ts:150`
 * shipped ahead of this ticket) — no hand-typing needed here, unlike the
 * reverse-mutation types below. */
export type PaymentDetail = components['schemas']['PaymentDetailDto'];
/** What a PARENT/STUDENT actually gets back from
 * `GET /payments/student/:studentId` — a reduced row with no `student`,
 * `received_by` or `remarks` (`schema.d.ts`'s `FamilyPaymentDto`, and the
 * published response contract on that operation). */
export type FamilyPayment = components['schemas']['FamilyPaymentDto'];
export type StudentFee = components['schemas']['StudentFee'];

/** `FeesController.getInvoiceSummary`'s untyped 200 body — same
 * documentation gap as `students.ts`'s `PaginatedStudents`, hand-typed
 * against what `fees.service.ts`'s `getInvoiceSummary` actually returns. */
export interface StudentFeeSummary {
  student_id: string;
  student_name: string;
  summary: {
    total_due: number;
    total_paid: number;
    total_discount: number;
    balance: number;
  };
  fee_breakdown: StudentFee[];
  payments: Payment[];
}

export const paymentKeys = createEntityKeys<{
  studentId?: string;
  guardianId?: string;
  search?: string;
}>('payments');

// ---- interim types: #658 GET /payments/cart ----
// #658/#659 (the cart and checkout endpoints) are being built in a sibling
// wave-4 lane and are not on `main` yet — `ui/src/api/schema.d.ts` has no
// `components['schemas']` entry for either. These are hand-written against
// the contract documented on those tickets (same pattern as
// `fee-generation.ts`'s `GenerateFees*` types and `students.ts`'s
// `StudentIdsResult`). **Reconciliation seam**: once w4-g1 lands and
// `schema.d.ts` regenerates, replace every type in this block with the
// generated `components['schemas']` equivalent.
export interface CartBill {
  student_fee_id: string;
  fee_name: string;
  fee_type: string;
  period_start: string;
  period_type: string;
  occurrence: number;
  total_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  is_late_fee: boolean;
  is_overdue: boolean;
  suggested_allocation: number;
}
export interface CartStudent {
  id: string;
  full_name: string;
  registration_number: string;
  class_name: string;
  section_name: string;
  wallet_balance: number;
  bills: CartBill[];
}
export interface CartSuggestion {
  allocations: { student_fee_id: string; amount: number }[];
  wallet_used: number;
  remaining: number;
  to_wallet: number;
}
export interface CartResult {
  students: CartStudent[];
  total_balance: number;
  suggested: CartSuggestion;
}

// ---- interim types: #659 POST /payments/checkout ----
export interface CheckoutLine {
  student_fee_id: string;
  amount: number;
  one_off_discount: number;
}
export type ChangeHandling = 'RETURN' | 'TO_WALLET';
export interface CheckoutInput {
  idempotency_key: string;
  lines: CheckoutLine[];
  payment_method: PaymentMethod;
  transaction_reference?: string;
  remarks?: string;
  tendered_amount?: number;
  wallet_use?: number;
  change_handling?: ChangeHandling;
  payment_date?: string;
}
export interface CheckoutResult {
  payment: Payment;
  invoice_id: string;
  invoice_number: string;
  change_amount: number;
  wallet_balance_after: number;
}

/** [16.4.4] Cart query keys — sorted student ids so key identity doesn't
 * depend on selection order (adding then removing a sibling, or the
 * reverse, must land on the same cache entry). There is no separate
 * wallet-balance query: `wallet_balance` rides on each `CartStudent` in
 * this response, so invalidating `cartKeys.all` is the wallet
 * invalidation too — see `useCheckout`'s `onSuccess` comment. */
export const cartKeys = {
  all: ['payments', 'cart'] as const,
  query: (studentIds: string[], amountMinorUnits?: number) =>
    ['payments', 'cart', [...studentIds].sort().join(','), amountMinorUnits ?? null] as const,
};

/**
 * [16.4.4] `GET /payments/cart` — every open bill for one or more
 * students, wallet balance, and an oldest-first allocation suggestion for
 * `amount`. `enabled: studentIds.length > 0` — nothing to fetch with no
 * student selected yet. `placeholderData: keepPreviousData` so retyping
 * the amount-received box doesn't blank the cart table between requests.
 *
 * `amountMinorUnits` is accepted (and cached) in minor units — same as
 * every other amount this hook module deals in — but the `amount` query
 * param the endpoint actually reads is documented major-unit decimal
 * (#658's contract example: `amount=5000` against `wallet_balance:50`,
 * `total_balance:5750`, matching `bill.balance`/`suggested_allocation` in
 * the same response, which are also major-unit). F1: this used to send
 * the raw minor-unit number, so `amount` was 100x every other field in
 * the same request/response pair.
 */
export function useCart({
  studentIds,
  amount: amountMinorUnits,
  config,
  enabled = true,
}: {
  studentIds: string[];
  amount?: number;
  /** Needed to turn `amount` (minor units, like every other amount this
   * hook module deals in) into the major-unit decimal string the `amount`
   * query param actually expects — see the header comment above. */
  config: RegionConfig;
  enabled?: boolean;
}) {
  return useQuery(
    queryOptions({
      queryKey: cartKeys.query(studentIds, amountMinorUnits),
      queryFn: async ({ signal }) => {
        const params = new URLSearchParams({ student_ids: [...studentIds].sort().join(',') });
        if (amountMinorUnits !== undefined) {
          params.set('amount', minorUnitsToDecimalString(amountMinorUnits, config));
        }
        const res = await apiClient.get<CartResult>(`/payments/cart?${params.toString()}`, {
          signal,
        });
        return res.data;
      },
      enabled: enabled && studentIds.length > 0,
      placeholderData: keepPreviousData,
      retry: shouldRetryQuery,
    }),
  );
}

/**
 * `POST /payments/checkout` — the plain request function, exported so
 * `useApprovedMutation`'s retry-with-token path can call it a second time
 * with the same shape (variables, `{ headers }`) it called the first
 * time. Not itself a hook — `useCheckout` below is the hook callers
 * actually use.
 */
async function checkoutRequest(
  input: CheckoutInput,
  options: { headers?: Record<string, string> } = {},
): Promise<CheckoutResult> {
  const res = await apiClient.post<CheckoutResult>(
    '/payments/checkout',
    input,
    options.headers ? { headers: options.headers } : undefined,
  );
  return res.data;
}

/**
 * [16.4.4] `POST /payments/checkout`, wrapped in `useApprovedMutation` per
 * the published plan's correction: the option key is `approvalScope`, not
 * `scope` (`ui/src/hooks/approval.tsx:96-109` reserves `scope` for
 * TanStack Query's own mutation-concurrency option). Any line with
 * `one_off_discount > 0` makes the whole checkout require
 * `ApprovalScope.FEES_DISCOUNT` — render `checkout.modal` once, anywhere
 * in the calling component's tree, or the approval prompt never appears.
 *
 * Deliberately has **no `onMutate`** — same non-optimistic reasoning as
 * the wizard's old `useRecordPaymentWithAllocation`. F11: this hook is
 * NOT protected by lint here — `ui/eslint-rules/financial-mutation.mjs`
 * matches literally on `callee.name === 'useMutation'`, not by path, so
 * wrapping in `useApprovedMutation` (as this hook does) bypasses the rule
 * entirely. The guarantee is only that this hook, as written today,
 * happens not to use `onMutate` — nothing enforces that staying true.
 */
export function useCheckout(): ApprovedMutationResult<CheckoutInput, CheckoutResult> {
  const queryClient = useQueryClient();
  return useApprovedMutation(checkoutRequest, {
    approvalScope: ApprovalScope.FEES_DISCOUNT,
    retry: false,
    onSuccess: () => {
      // `cartKeys.all`, not a narrower key — a checkout changes every open
      // bill's balance and the wallet_balance carried on the cart
      // response. `walletKeys.all` is invalidated separately below: a
      // checkout can also change the wallet via `wallet_use` or a
      // `TO_WALLET` change-handling credit, and `useStudentWallet` caches
      // that balance/history under its own `walletKeys` prefix, not
      // under the cart's. `paymentKeys.all` (a plain `['payments']`
      // prefix from `createEntityKeys`) also covers `useStudentFeeSummary`'s
      // `[...paymentKeys.all, 'fee-summary', studentId]` cache entries — no
      // separate per-student invalidation is needed for those. The modal
      // itself additionally invalidates `studentKeys.detail(id)` for every
      // selected student, since `CheckoutLine` doesn't carry a student id
      // this hook could loop over.
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: feeDuesKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: walletKeys.all });
    },
  });
}

/** [8.10.2]'s Payments tab — every payment ever recorded for one student,
 * newest first.
 *
 * The response type is a union because the endpoint's is: staff get raw
 * `Payment` rows, a PARENT/STUDENT gets reduced `FamilyPaymentDto` rows
 * ([5.1] widened the route to family callers, and the operation's
 * published contract says so). Typing it `Payment[]` was a lie for half
 * the callers — it let a family-facing screen write `payment.student.id`
 * and type-check, against a body where `student` does not exist. Callers
 * that need staff-only fields must narrow first; the fields both shapes
 * share (`payment_date`, `payment_method`, `transaction_reference`,
 * `total_amount`, `payment_status`) are readable without narrowing. No
 * behaviour change — staff callers get exactly the same rows as before. */
export function usePaymentsByStudent(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: paymentKeys.list({ studentId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<(Payment | FamilyPayment)[]>(
          `/payments/student/${studentId}`,
          { signal },
        );
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.11.4]'s Payment History tab — every payment recorded for any of a
 * guardian's linked students, newest first. Mirrors `usePaymentsByStudent`
 * above, backed by `fees.controller.ts`'s `GET payments/guardian/:guardianId`. */
export function usePaymentsByGuardian(guardianId: string) {
  return useQuery(
    queryOptions({
      queryKey: paymentKeys.list({ guardianId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<Payment[]>(`/payments/guardian/${guardianId}`, {
          signal,
        });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

/** [8.10.2]'s Fees tab — outstanding/paid/billed balance plus the
 * fee-by-fee breakdown behind it. Keyed under `paymentKeys`, not a
 * separate `feeKeys` — this is `FeesController`'s own
 * `payments/invoices/student/:studentId`, the payment side of the fees
 * module, not the `fee-structures`/`fees/dues` side. */
export function useStudentFeeSummary(studentId: string | undefined) {
  return useQuery(
    queryOptions({
      // Not `paymentKeys.list(...)` — that shape is a `Payment[]`, and this
      // is a `StudentFeeSummary` object; sharing the key would let this
      // query's cache entry collide with `usePaymentsByStudent`'s. `??
      // studentId` for a defined caller doesn't change the key at all —
      // the fallback only matters once `studentId` is `undefined`.
      queryKey: [...paymentKeys.all, 'fee-summary', studentId ?? null] as const,
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<StudentFeeSummary>(
          `/payments/invoices/student/${studentId}`,
          { signal },
        );
        return res.data;
      },
      enabled: studentId !== undefined,
      retry: shouldRetryQuery,
    }),
  );
}

/** [16.6.2] `GET /payments/:id` — the staff-only detail page's row. Not a
 * `queryOptions()` export like `invoiceQueryOptions` (no route `loader`
 * needs it as a standalone object — the detail route only reads it inside
 * the component). */
export function usePayment(id: string) {
  return useQuery(
    queryOptions({
      queryKey: paymentKeys.detail(id),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<PaymentDetail>(`/payments/${id}`, { signal });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}

// ---- #670 POST /payments/:id/reverse ----
export interface ReversePaymentInput {
  paymentId: string;
  reason: string;
}
export type ReversePaymentResult = Payment;
/** D9's approval-required shape (`403 { code: 'APPROVAL_REQUIRED', scope }`)
 * is handled generically by `useApprovedMutation`. D10's in-order rule
 * surfaces as this 409 instead — the dialog reads `error.details` for it. */
export interface ReverseLaterPaymentsFirstDetails {
  code: 'REVERSE_LATER_PAYMENTS_FIRST';
  payment_ids: string[];
}

async function reversePaymentRequest(
  { paymentId, reason }: ReversePaymentInput,
  options: { headers?: Record<string, string> } = {},
): Promise<ReversePaymentResult> {
  const res = await apiClient.post<ReversePaymentResult>(
    `/payments/${paymentId}/reverse`,
    { reason },
    options.headers ? { headers: options.headers } : undefined,
  );
  return res.data;
}

/** [16.6.2] `POST /payments/:id/reverse`, wrapped in `useApprovedMutation`
 * per D9 — same shape `useCheckout` above uses, `ApprovalScope.PAYMENTS_REVERSE`
 * in place of `FEES_DISCOUNT`. Invalidates both the reversed payment's own
 * detail (`reversed_by_payment_id` now set) and the list/fee-summary caches,
 * same reasoning `useCheckout`'s own `onSuccess` comment gives. */
export function useReversePayment(): ApprovedMutationResult<
  ReversePaymentInput,
  ReversePaymentResult
> {
  const queryClient = useQueryClient();
  return useApprovedMutation(reversePaymentRequest, {
    approvalScope: ApprovalScope.PAYMENTS_REVERSE,
    retry: false,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.detail(variables.paymentId) });
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: walletKeys.all });
    },
  });
}
