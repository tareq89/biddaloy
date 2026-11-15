import { apiClient } from '@biddaloy/ui/api';
import { useIdempotencyKey } from '@biddaloy/ui/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface StaffApplicantInput {
  intake_id: string;
  applicant_name: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  /** Every ticked field that is not one of the five columns above. */
  extra_fields: Record<string, string | number | boolean>;
  allow_after_close?: boolean;
  fee_method?: string;
  fee_reference?: string;
  /** One file per document type, keyed by the lowercase multipart field name. */
  documents: Record<string, File>;
  fee_proof?: File;
}

export interface StaffApplicantResult {
  reference_number: string;
  status: string;
  warnings?: string[];
}

/** Everything except the files; this is what makes one attempt (the Idempotency-Key body). */
function attemptBody(input: StaffApplicantInput) {
  const { documents, fee_proof, ...rest } = input;
  return {
    ...rest,
    documents: Object.entries(documents).map(([k, f]) => [k, f.name, f.size]),
    fee_proof: fee_proof ? [fee_proof.name, fee_proof.size] : null,
  };
}

/** `POST /admission/applicants` — a clerk enters an application for a walk-in guardian (Rule 25: no retry, Idempotency-Key). */
export function useCreateApplicantStaff() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: StaffApplicantInput) => {
      const form = new FormData();
      form.append('intake_id', input.intake_id);
      form.append('applicant_name', input.applicant_name);
      form.append('date_of_birth', input.date_of_birth);
      form.append('gender', input.gender);
      form.append('guardian_name', input.guardian_name);
      form.append('guardian_phone', input.guardian_phone);
      form.append('extra_fields', JSON.stringify(input.extra_fields));
      if (input.allow_after_close) form.append('allow_after_close', 'true');
      if (input.fee_method) form.append('fee_method', input.fee_method);
      if (input.fee_reference) form.append('fee_reference', input.fee_reference);
      for (const [field, file] of Object.entries(input.documents)) form.append(field, file);
      if (input.fee_proof) form.append('fee_proof', input.fee_proof);
      const res = await apiClient.post<StaffApplicantResult>('/admission/applicants', form, {
        headers: { 'Idempotency-Key': keyFor(attemptBody(input)) },
      });
      return res.data;
    },
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: ['admission-applicants'] });
      void queryClient.invalidateQueries({ queryKey: ['admission-fee-proofs'] });
    },
    retry: false,
  });
}
