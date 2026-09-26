/**
 * [27.7] `POST /public/admission/:slug/status`. Guardian phone travels as a
 * second factor in the body, not a query-string param, so it never lands
 * in an access/proxy log.
 */
import { ApiError } from '@biddaloy/ui/api';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';

import { toApiError } from './toApiError';

const API_BASE_URL = '/api/v1';

export interface AdmissionStatusResult {
  status: string;
  applicant_name: string;
  intake_title: string;
}

export interface CheckAdmissionStatusInput {
  referenceNumber: string;
  guardianPhone: string;
}

async function checkStatus(
  slug: string,
  input: CheckAdmissionStatusInput,
): Promise<AdmissionStatusResult> {
  try {
    const response = await axios.post<AdmissionStatusResult>(
      `${API_BASE_URL}/public/admission/${encodeURIComponent(slug)}/status`,
      { reference_number: input.referenceNumber, guardian_phone: input.guardianPhone },
    );
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export function useAdmissionStatus(slug: string) {
  return useMutation({
    mutationFn: (input: CheckAdmissionStatusInput) => checkStatus(slug, input),
  });
}

export function isUnknownReference(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}
