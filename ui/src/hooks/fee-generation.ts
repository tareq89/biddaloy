import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { feeDuesKeys } from './fee-dues';
import { paymentKeys } from './payments';

export type GenerateFeesInput = components['schemas']['GenerateStudentFeesDto'];
export type GenerateFeesResult = components['schemas']['GenerateFeesResultDto'];

/**
 * [8.11.6] — `POST /fees/generate`, the monthly batch write behind
 * `/fees/generate`'s wizard.
 *
 * **No optimistic write**, same reasoning `payments.ts`'s
 * `useCreatePayment` spells out at length: this creates fee records for
 * potentially hundreds of students, so the only honest signal while it's
 * in flight is `isPending`. Nothing lands in the cache until `onSuccess`.
 *
 * **`retry: false`**, deliberately *not* `shouldRetryQuery` (which every
 * read hook here uses). Two reasons:
 * - The endpoint carries `STRICT_RATE_LIMIT` — 5 requests per 60 seconds
 *   (`server/src/rate-limit.ts`). `shouldRetryQuery` would bail on that
 *   429, but it retries every network-level failure — and a batch write
 *   that timed out may already have committed, so a blind retry spends
 *   another of the five allowed runs on a request whose first attempt's
 *   outcome is unknown.
 * - The wizard's whole point is a human deciding to run the batch. A
 *   silent client-side retry of a batch write is the opposite of the
 *   "see what will happen before it happens" contract the screen makes.
 *
 * Re-running is still safe server-side (the insert is `ON CONFLICT DO
 * NOTHING`, which is what `skipped` counts) — that's a property of the
 * endpoint, not a licence for the client to retry on its own.
 */
export function useGenerateFees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateFeesInput) => {
      const res = await apiClient.post<GenerateFeesResult>('/fees/generate', input);
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      // New `StudentFee` rows change what's outstanding, so the dues queue
      // is stale. The whole `lists()` branch, not one filter variant —
      // same reasoning `useCreatePayment` gives for its own invalidation.
      void queryClient.invalidateQueries({ queryKey: feeDuesKeys.lists() });
      // `paymentKeys.all`, not `.lists()`: the query this batch actually
      // invalidates is `useStudentFeeSummary`, whose key is
      // `[...paymentKeys.all, 'fee-summary', id]` and therefore sits
      // *outside* the `lists()` branch (see its own comment in
      // `payments.ts`). Invalidating `lists()` alone would leave the
      // record-payment wizard's outstanding-fees step showing a summary
      // that predates the fees just generated.
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
    },
  });
}
