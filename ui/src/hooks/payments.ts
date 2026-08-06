import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentKeys } from './students';

export type Payment = components['schemas']['Payment'];
export type CreatePaymentInput = components['schemas']['CreatePaymentDto'];

export const paymentKeys = createEntityKeys<{ studentId?: string }>('payments');

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
