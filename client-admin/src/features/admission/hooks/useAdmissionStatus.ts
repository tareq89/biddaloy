/**
 * [27.8] `GET /public/admission/:slug/status/:referenceNumber`. That route
 * is being added in parallel by a sibling ticket (#1042) and may not exist
 * yet on this branch — `enabled` below only fires the request once a
 * reference number has actually been entered, so this hook compiles and
 * renders cleanly either way; the real response wiring is confirmed at
 * epic integration once #1042 lands. Same bare-`axios` reasoning as
 * `useSubmitApplicant.ts` (no `apiClient`, no active tenant on a public
 * page).
 */
import { ApiError } from '@biddaloy/ui/api';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { toApiError } from './toApiError';

const API_BASE_URL = '/api/v1';

export interface AdmissionStatusResult {
  status: string;
  applicant_name: string;
  intake_title: string;
}

async function fetchStatus(
  slug: string,
  referenceNumber: string,
  signal?: AbortSignal,
): Promise<AdmissionStatusResult> {
  try {
    const response = await axios.get<AdmissionStatusResult>(
      `${API_BASE_URL}/public/admission/${slug}/status/${referenceNumber}`,
      { ...(signal ? { signal } : {}) },
    );
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export function useAdmissionStatus(slug: string, referenceNumber: string) {
  return useQuery({
    queryKey: ['public-admission-status', slug, referenceNumber] as const,
    queryFn: ({ signal }) => fetchStatus(slug, referenceNumber, signal),
    enabled: referenceNumber.trim().length > 0,
    retry: false,
  });
}

export function isUnknownReference(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}
