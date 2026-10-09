/**
 * [27.8] Local copy of `ui/src/api/client.ts`'s (unexported) `toApiError` —
 * this ticket's territory doesn't include that package, and the shape is
 * small enough that duplicating it here beats widening scope to export it.
 * Shared by `useSubmitApplicant.ts` and `useAdmissionStatus.ts` so it's
 * defined once, not per-hook.
 */
import { ApiError, type ApiErrorBody } from '@biddaloy/ui/api';
import axios from 'axios';

export function toApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (
      body &&
      typeof body.statusCode === 'number' &&
      (typeof body.message === 'string' || Array.isArray(body.message)) &&
      typeof body.requestId === 'string'
    ) {
      return new ApiError(body as ApiErrorBody);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
