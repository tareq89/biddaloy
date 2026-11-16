import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';

export type StaffMessageInput = components['schemas']['StaffMessageDto'];
export type StaffAudienceInput = components['schemas']['StaffAudienceDto'];
export type StaffMessagePreview = components['schemas']['StaffMessagePreviewResponseDto'];
export type StaffMessageSendResult = components['schemas']['StaffMessageSendResponseDto'];
export type StaffSkipped = components['schemas']['StaffSkippedDto'];

/**
 * `POST /communications/staff/preview` — the review step. A mutation, not a
 * query: an explicit action on the inputs as composed right now, writes nothing.
 */
export function useStaffMessagePreview() {
  return useMutation({
    mutationFn: async (input: StaffMessageInput) => {
      const res = await apiClient.post<StaffMessagePreview>('/communications/staff/preview', input);
      return res.data;
    },
  });
}

/**
 * `POST /communications/staff` — spends credits, so `retry: false` and one
 * Idempotency-Key per composed message until a success (Rule 25).
 */
export function useSendStaffMessage() {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: StaffMessageInput) => {
      const res = await apiClient.post<StaffMessageSendResult>('/communications/staff', input, {
        headers: { 'Idempotency-Key': keyFor(input) },
      });
      return res.data;
    },
    onSuccess: rotate,
    // The page says "could not confirm" itself.
    meta: { handlesUnknownOutcome: true },
    retry: false,
  });
}
