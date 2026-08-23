import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentKeys } from './students';

export type Payment = components['schemas']['Payment'];
export type CreatePaymentInput = components['schemas']['CreatePaymentDto'];
export type StudentFee = components['schemas']['StudentFee'];
export type PaymentAllocationInput = components['schemas']['PaymentAllocationInputDto'];
export type RecordPaymentWithAllocationInput =
  components['schemas']['RecordPaymentWithAllocationDto'];

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

export const paymentKeys = createEntityKeys<{ studentId?: string; search?: string }>('payments');

/**
 * The reference **non-optimistic** financial mutation — [8.4.4]'s counter
 * example to `students.ts`'s `useUpdateStudentPreferredCommunication`.
 * Deliberately has no `onMutate`: a payment is exactly the case an
 * optimistic update must never touch. Showing "৳4,500 received" before the
 * server confirms it means the UI told a parent standing at the counter
 * that their payment succeeded when it might not have — the guarded
 * `no-optimistic-financial-mutation` ESLint rule (see `../eslint-rules/
 * financial-mutation.mjs`) fails the build if `onMutate` is ever added
 * here. The UI's only signal during the request is `isPending`; there is
 * no cache write, optimistic or otherwise, until `onSuccess` actually
 * runs — see `ui/README.md`'s "Optimistic updates" section for the full
 * pattern this hook is the reference for.
 */
export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const res = await apiClient.post<Payment>('/payments', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: (payment) => {
      // The whole `lists()` branch, not just `list({ studentId })` — the
      // same reasoning as `students.ts`'s `useCreateStudent`: a new
      // payment can affect an unfiltered list or one filtered a
      // different way too, and scoping this to a single filter variant
      // would leave those other cached views stale.
      void queryClient.invalidateQueries({ queryKey: paymentKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(payment.student.id) });
    },
  });
}

/** [8.10.2]'s Payments tab — every payment ever recorded for one student,
 * newest first. */
export function usePaymentsByStudent(studentId: string) {
  return useQuery(
    queryOptions({
      queryKey: paymentKeys.list({ studentId }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<Payment[]>(`/payments/student/${studentId}`, { signal });
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
      // studentId` for a defined caller (every caller before [8.10.5])
      // doesn't change the key at all — the fallback only matters once
      // `studentId` is `undefined`.
      queryKey: [...paymentKeys.all, 'fee-summary', studentId ?? null] as const,
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<StudentFeeSummary>(
          `/payments/invoices/student/${studentId}`,
          { signal },
        );
        return res.data;
      },
      // [8.10.5]'s Record Payment wizard doesn't know the student yet on
      // its first step — `enabled: false` until it does, rather than
      // every caller having to pass a placeholder id just to satisfy this
      // hook's old `string`-only signature.
      enabled: studentId !== undefined,
      retry: shouldRetryQuery,
    }),
  );
}

/**
 * [8.10.5]'s Record Payment wizard. Same non-optimistic shape as
 * `useCreatePayment` — this is the endpoint the "money is never
 * optimistic" rule most directly protects, since a counter payment that
 * looked successful and then rolled back is exactly the failure mode the
 * issue calls out.
 *
 * `record-with-allocation`'s response never asks for the `student`
 * relation (`payment-allocation.service.ts`'s final `findOneOrFail` only
 * loads `allocations`, `allocations.student_fee`, `invoice`) — the
 * generated `Payment` type still claims `student` is present because it's
 * shared across every endpoint that returns a `Payment`, not because this
 * one populates it. Using `payment.student_id` (a plain column, always
 * present) instead of `payment.student.id` avoids reading through
 * `undefined`.
 */
export function useRecordPaymentWithAllocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordPaymentWithAllocationInput) => {
      const res = await apiClient.post<Payment>('/payments/record-with-allocation', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(payment.student_id) });
      void queryClient.invalidateQueries({
        queryKey: [...paymentKeys.all, 'fee-summary', payment.student_id],
      });
    },
  });
}
