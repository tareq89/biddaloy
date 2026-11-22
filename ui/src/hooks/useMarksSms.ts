import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { useIdempotencyKey } from './idempotency-key';

/**
 * Hand-typed against `marks-sms.service.ts` (`MarksSmsPreview` / `MarksSmsOutcome`): the
 * controller returns plain objects, so the OpenAPI schema carries no DTO for them.
 */
export interface MarksSmsSkipped {
  student_id: string;
  reason: 'no_reachable_guardian' | 'notifications_off' | 'no_marks';
}
export interface MarksSmsPreview {
  /** Messages (one per student x guardian) a send would queue now. */
  count: number;
  /** SMS credits those messages cost. */
  segments: number;
  skipped: MarksSmsSkipped[];
  /** Set only when everything was already sent: when. */
  already_sent_at: string | null;
}
export interface MarksSmsSendResult {
  queued: number;
  segments: number;
  skipped: MarksSmsSkipped[];
  already_sent_at: string | null;
}

export interface MarksSmsGrid {
  examId: string;
  sectionId: string;
  subjectId: string;
}

const path = (g: MarksSmsGrid) => `/exams/${g.examId}/marks/${g.sectionId}/${g.subjectId}/sms`;

/** `POST …/sms/preview` — counts only, writes nothing. */
export function useMarksSmsPreview(grid: MarksSmsGrid) {
  return useMutation({
    mutationFn: async () => (await apiClient.post<MarksSmsPreview>(`${path(grid)}/preview`)).data,
  });
}

/** `POST …/sms` — spends credits: `retry: false` and one Idempotency-Key per attempt (Rule 25). */
export function useSendMarksSms(grid: MarksSmsGrid) {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<MarksSmsSendResult>(path(grid), undefined, {
          headers: { 'Idempotency-Key': keyFor(path(grid)) },
        })
      ).data,
    onSuccess: rotate,
    // The page says "could not confirm" itself.
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}
