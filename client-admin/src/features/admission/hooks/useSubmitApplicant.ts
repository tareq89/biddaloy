/**
 * [27.8] Public, unauthenticated data access for `/admission/<slug>` —
 * deliberately bare `axios`, never `@biddaloy/ui/api`'s `apiClient`. That
 * client's request interceptor throws `NoActiveTenantError` when no tenant
 * is active (`ui/src/api/client.ts`), and a prospective guardian opening
 * this link cold never has one. Same reasoning as `client-admin/src/routes/
 * i/$token.tsx`'s `usePublicInvoice` — this is that pattern's admission
 * sibling, kept local to this feature rather than added to `ui/src/api`
 * since this ticket's territory doesn't include that package.
 */
import type { AdmissionDocumentType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { toApiError } from './toApiError';

const API_BASE_URL = '/api/v1';

export interface PublicIntake {
  id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
}

export interface SubmitApplicantInput {
  intake_id: string;
  applicant_name: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email?: string;
  home_address?: string;
  /** Honeypot — must stay empty, never rendered visibly. */
  middle_name_confirm: string;
  /** One `File` per required document type, keyed by the lowercase field
   * name the server's `AnyFilesInterceptor` expects (`photo`,
   * `birth_certificate`, `transcript`). */
  documents: Record<string, File>;
}

export interface SubmitApplicantResult {
  reference_number: string;
  status: string;
}

async function fetchOpenIntakes(slug: string, signal?: AbortSignal): Promise<PublicIntake[]> {
  try {
    const response = await axios.get<PublicIntake[]>(`${API_BASE_URL}/public/admission/${slug}`, {
      ...(signal ? { signal } : {}),
    });
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** `GET /public/admission/:slug` — every open intake with a required-document
 * list, used to build the dynamic upload fields below the fixed form. */
export function usePublicIntakes(slug: string) {
  return useQuery({
    queryKey: ['public-admission-intakes', slug] as const,
    queryFn: ({ signal }) => fetchOpenIntakes(slug, signal),
    retry: false,
  });
}

/** Maps a document-type enum value to the multipart field name the
 * controller's `@ApiBody` schema declares (`photo`/`birth_certificate`/
 * `transcript`) — the enum is already SCREAMING_SNAKE, this is just the
 * lowercase form. */
export function documentFieldName(type: AdmissionDocumentType): string {
  return type.toLowerCase();
}

async function submitApplicant(
  slug: string,
  input: SubmitApplicantInput,
): Promise<SubmitApplicantResult> {
  const formData = new FormData();
  formData.append('intake_id', input.intake_id);
  formData.append('applicant_name', input.applicant_name);
  formData.append('date_of_birth', input.date_of_birth);
  formData.append('gender', input.gender);
  formData.append('guardian_name', input.guardian_name);
  formData.append('guardian_phone', input.guardian_phone);
  if (input.guardian_email) formData.append('guardian_email', input.guardian_email);
  if (input.home_address) formData.append('home_address', input.home_address);
  // Never rendered, always sent empty by a real submission — see the DTO's
  // own comment on the server side.
  formData.append('middle_name_confirm', input.middle_name_confirm);
  for (const [field, file] of Object.entries(input.documents)) {
    formData.append(field, file);
  }

  try {
    const response = await axios.post<SubmitApplicantResult>(
      `${API_BASE_URL}/public/admission/${slug}/applicants`,
      formData,
    );
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export function useSubmitApplicant(slug: string) {
  return useMutation({
    mutationFn: (input: SubmitApplicantInput) => submitApplicant(slug, input),
  });
}

/** A closed/not-yet-open intake list (empty array) vs. an unknown school
 * (404) are different failure shapes the form needs to tell apart. */
export function isUnknownSchool(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}
