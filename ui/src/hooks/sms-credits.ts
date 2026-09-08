import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type SmsCreditsResponse = components['schemas']['SmsCreditsResponseDto'];
export type SmsCreditLedgerItem = components['schemas']['SmsCreditLedgerItemDto'];

export interface SmsCreditsFilters {
  page: number;
  limit: number;
}

export const smsCreditsKeys = createEntityKeys<SmsCreditsFilters>('sms-credits');

/**
 * `GET /communications/sms-credits` — [15.6.8] Settings' credit section:
 * this tenant's own metering mode, balance and ledger page. `metering:
 * 'OFF'` still returns the same shape (an always-0/0 balance, an empty
 * ledger) — see the server DTO's own comment — so the UI never needs a
 * second response contract for the unmetered case.
 */
export function smsCreditsQueryOptions(page: number, limit: number) {
  return queryOptions({
    queryKey: smsCreditsKeys.list({ page, limit }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SmsCreditsResponse>('/communications/sms-credits', {
        params: { page, limit },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [8.14.6]'s pattern — a page change keeps the previous page's rows
    // (and `isFetching` true) instead of the ledger table collapsing to a
    // loading row height on every click.
    placeholderData: keepPreviousData,
  });
}

export function useSmsCredits(page = 1, limit = 20) {
  return useQuery(smsCreditsQueryOptions(page, limit));
}

export type GrantSmsCreditsInput = components['schemas']['GrantSmsCreditsDto'];

/**
 * `POST /schools/:id/sms-credits` (#550) — the SUPER_ADMIN console's
 * grant/adjust form. The server's `@ApiOkResponse` only carries a
 * description ("The new balance: { available, reserved }"), not a typed
 * body, so `schema.d.ts` generates `content?: never` for its 200 — this
 * hook types the actual runtime shape by hand rather than leaving callers
 * to deal with `unknown`.
 *
 * Invalidates `sms-credits` broadly: the platform caller isn't necessarily
 * a member of the target school (so it can't invalidate a tenant-scoped
 * `useSmsCredits` list key it may never have queried), and a grant against
 * a school the current session *is* a member of (rare, but possible for a
 * SUPER_ADMIN who is also staff there) should still refresh that tenant's
 * own balance view.
 */
export function useGrantSmsCredits(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GrantSmsCreditsInput) => {
      const res = await apiClient.post<{ available: number; reserved: number }>(
        `/schools/${schoolId}/sms-credits`,
        input,
      );
      return res.data;
    },
    // Not `shouldRetryQuery`: a dropped-response retry with a *different*
    // idempotency key would double the grant. Callers that want retry
    // safety generate one `idempotency_key` per submit attempt and reuse
    // it across their own retries (see the grant form).
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: smsCreditsKeys.all });
    },
  });
}
