import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type SendBulkReminderInput = components['schemas']['SendBulkReminderDto'];
export type ReminderBatchResponse = components['schemas']['ReminderBatchResponseDto'];

/**
 * `POST /communications/reminder/bulk` — not a financial mutation, so `useCreatePayment`'s
 * `onMutate`-ban doesn't apply here. Still no optimistic write, though:
 * there's no reminder-batch cache in this ticket's scope for an optimistic
 * value to land in, so a plain mutation is the whole story. The caller
 * (`send-reminder-dialog.tsx`) reads `isPending`/`isError` directly rather
 * than this hook pre-computing UI state — same "hook owns the request,
 * caller owns the presentation" split every other mutation hook here uses.
 */
export function useSendBulkReminder() {
  return useMutation({
    mutationFn: async (input: SendBulkReminderInput) => {
      const res = await apiClient.post<ReminderBatchResponse>(
        '/communications/reminder/bulk',
        input,
      );
      return res.data;
    },
    // Not `shouldRetryQuery` like every other mutation here: this endpoint
    // isn't idempotent — a retry after a dropped response (not just a
    // dropped request) creates a second ReminderBatch, a second set of
    // communication logs, and a second batch of outbound queue jobs for
    // the same students, not just a harmless re-send of an identical one.
    retry: false,
  });
}
