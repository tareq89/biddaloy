import { keepPreviousData, queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

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

export type SendSingleReminderInput = components['schemas']['SendSingleReminderDto'];
export type ReminderPreview = components['schemas']['ReminderPreviewResponseDto'];
export type ReminderPreviewRecipient = components['schemas']['ReminderPreviewRecipientDto'];
export type SkippedGuardian = components['schemas']['SkippedGuardianDto'];
export type SingleReminderResult = components['schemas']['SingleReminderResponseDto'];

export interface SingleReminderVariables {
  studentId: string;
  input: SendSingleReminderInput;
}

/**
 * `POST /communications/reminder/single/{studentId}/preview` — [8.11.9]'s
 * mandatory review step. A mutation rather than a query on purpose: a
 * preview is an explicit user action against the inputs *as composed right
 * now* (the page's staleness guard hashes those inputs), not a cacheable
 * read that background refetching should ever re-run on its own. Returns
 * 200 with `recipients[]` and `skipped[]`; sends nothing.
 */
export function useSingleReminderPreview() {
  return useMutation({
    mutationFn: async ({ studentId, input }: SingleReminderVariables) => {
      const res = await apiClient.post<ReminderPreview>(
        `/communications/reminder/single/${studentId}/preview`,
        input,
      );
      return res.data;
    },
  });
}

/**
 * `POST /communications/reminder/single/{studentId}` — the send half of
 * the preview/send pair above. `retry: false` for the same reason
 * `useSendBulkReminder` gives: a retry after a dropped *response* would
 * queue a second, identical reminder to the same guardians.
 */
export function useSendSingleReminder() {
  return useMutation({
    mutationFn: async ({ studentId, input }: SingleReminderVariables) => {
      const res = await apiClient.post<SingleReminderResult>(
        `/communications/reminder/single/${studentId}`,
        input,
      );
      return res.data;
    },
    retry: false,
  });
}

export type BulkReminderPreview = components['schemas']['BulkReminderPreviewResponseDto'];
export type BulkPreviewStudent = components['schemas']['BulkPreviewStudentDto'];
export type BulkPreviewSkipped = components['schemas']['BulkPreviewSkippedDto'];
export type ReminderBatchListItem = components['schemas']['ReminderBatchListItemDto'];
export type PaginatedReminderBatches = components['schemas']['ReminderBatchListResponseDto'];
export type ReminderBatchLog = components['schemas']['ReminderBatchLogDto'];
export type PaginatedReminderBatchLogs = components['schemas']['ReminderBatchLogListResponseDto'];
export type SkippedRecipient = components['schemas']['SkippedRecipientDto'];

/**
 * `POST /communications/reminder/bulk/preview` — the bulk wizard's
 * mandatory review step. Write-free on the server, but still a mutation
 * for the same reason `useSingleReminderPreview` gives: a preview is an
 * explicit user action against the inputs as composed right now (the
 * wizard fingerprints them), never a background-refetchable read.
 */
export function useBulkReminderPreview() {
  return useMutation({
    mutationFn: async (input: SendBulkReminderInput) => {
      const res = await apiClient.post<BulkReminderPreview>(
        '/communications/reminder/bulk/preview',
        input,
      );
      return res.data;
    },
  });
}

export interface ReminderBatchListFilters {
  page?: number;
  limit?: number;
}

export const reminderBatchKeys = createEntityKeys<ReminderBatchListFilters>('reminder-batches');

export function reminderBatchesQueryOptions(filters: ReminderBatchListFilters = {}) {
  return queryOptions({
    queryKey: reminderBatchKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedReminderBatches>('/communications/reminder/bulk', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useReminderBatches(filters: ReminderBatchListFilters = {}) {
  return useQuery(reminderBatchesQueryOptions(filters));
}

/** How often the batch detail page re-asks the server about a batch that
 * is still being worked through. */
export const REMINDER_BATCH_POLL_MS = 3000;

/**
 * `GET /communications/reminder/bulk/{id}` — polls every
 * `REMINDER_BATCH_POLL_MS` **only while the batch is `PROCESSING`** and
 * stops the moment it settles (COMPLETED / PARTIALLY_FAILED / FAILED):
 * the `refetchInterval` callback re-evaluates against the freshest data
 * after every fetch, so the last PROCESSING response schedules exactly
 * one more poll and a settled response schedules none. [8.11.9]'s
 * "polling runs only while the batch is in progress" AC, in one line.
 */
export function reminderBatchQueryOptions(id: string) {
  return queryOptions({
    queryKey: reminderBatchKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ReminderBatchResponse>(
        `/communications/reminder/bulk/${id}`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
    refetchInterval: (query) =>
      query.state.data?.status === 'PROCESSING' ? REMINDER_BATCH_POLL_MS : false,
  });
}

export function useReminderBatch(id: string | undefined) {
  return useQuery({
    ...reminderBatchQueryOptions(id ?? ''),
    enabled: id !== undefined,
  });
}

/** Logs keys nest under the batch's own detail key — invalidating one
 * batch's `detail(id)` subtree takes its log pages with it, without a
 * second parallel entity family to keep in sync. */
export function reminderBatchLogsKeyPrefix(id: string) {
  return [...reminderBatchKeys.detail(id), 'logs'] as const;
}

export function reminderBatchLogsKey(id: string, filters: ReminderBatchListFilters = {}) {
  return [...reminderBatchLogsKeyPrefix(id), filters] as const;
}

export interface ReminderBatchLogsOptions {
  /** Poll the log pages on the same cadence as the batch itself. Callers
   * pass `batch.status === 'PROCESSING'`: the batch header's counters tick
   * up as the worker gets through the queue, so a delivery table frozen on
   * the first response — 50 QUEUED rows under a header reading "48 sent,
   * 2 failed" — is the page contradicting itself. */
  poll?: boolean;
}

export function reminderBatchLogsQueryOptions(
  id: string,
  filters: ReminderBatchListFilters = {},
  { poll = false }: ReminderBatchLogsOptions = {},
) {
  return queryOptions({
    queryKey: reminderBatchLogsKey(id, filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedReminderBatchLogs>(
        `/communications/reminder/bulk/${id}/logs`,
        { params: filters, signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
    refetchInterval: poll ? REMINDER_BATCH_POLL_MS : false,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useReminderBatchLogs(
  id: string | undefined,
  filters: ReminderBatchListFilters = {},
  options: ReminderBatchLogsOptions = {},
) {
  return useQuery({
    ...reminderBatchLogsQueryOptions(id ?? '', filters, options),
    enabled: id !== undefined,
  });
}

/** The server caps `limit` at 100 (`QueryReminderBatchesDto`) — paging
 * for `collectFailedStudentIds` walks in the biggest strides allowed. */
const LOGS_PAGE_LIMIT = 100;

/**
 * Walks every page of a batch's logs and returns the distinct
 * `student_id`s whose delivery FAILED — the exact `student_ids` a retry
 * composes its fresh `POST /reminder/bulk` from. A plain async function
 * rather than a hook: the batch detail page calls it inside its retry
 * confirm handler, one shot, no cache involvement wanted (a stale cached
 * page must never decide who gets re-messaged).
 */
export async function collectFailedStudentIds(batchId: string): Promise<string[]> {
  const failed = new Set<string>();
  let page = 1;
  let totalPages: number;
  do {
    const res = await apiClient.get<PaginatedReminderBatchLogs>(
      `/communications/reminder/bulk/${batchId}/logs`,
      { params: { page, limit: LOGS_PAGE_LIMIT } },
    );
    for (const log of res.data.data) {
      if (log.status === 'FAILED' && log.student_id !== null) failed.add(log.student_id);
    }
    totalPages = res.data.totalPages;
    page += 1;
  } while (page <= totalPages);
  return Array.from(failed);
}
