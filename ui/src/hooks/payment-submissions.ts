import type {
  PaymentMethod,
  PaymentProofRejectReason,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// ---- Types: guardian portal (`/portal/payment-proofs`, #3965) ----

type Schemas = components['schemas'];
export type ProofSubmission = Schemas['ProofSubmissionResponseDto'];
export type PaymentOptions = Schemas['PaymentOptionsResponseDto'];
export type PaymentCart = Schemas['PaymentCartResponseDto'];

export interface SubmitProofInput {
  billIds: string[];
  method: PaymentMethod;
  /** Taka; must equal the bills' balance. */
  amount: number;
  /** `YYYY-MM-DD`. */
  paidOn: string;
  reference?: string;
  /** Up to 2 JPG/PNG/PDF files. */
  files?: File[];
}

// ---- Types: staff review (`/payment-submissions`, #3970). The routes have no response DTO. ----

export interface ProofReviewListItem {
  id: string;
  source: PaymentSubmissionSource;
  status: PaymentSubmissionStatus;
  method: PaymentMethod | null;
  amount: string;
  paidOn: string | null;
  reference: string | null;
  submitterName: string;
  billCount: number;
  createdAt: string;
}

export interface ProofReviewList {
  items: ProofReviewListItem[];
  nextCursor: string | null;
}

export interface ProofReviewDetail {
  id: string;
  source: PaymentSubmissionSource;
  status: PaymentSubmissionStatus;
  method: PaymentMethod | null;
  amount: string;
  paidOn: string | null;
  reference: string | null;
  createdAt: string;
  guardian: { userId: string; name: string; phone: string | null };
  rejectReason: PaymentProofRejectReason | null;
  rejectNote: string | null;
  discardReason: string | null;
  /** Another waiting proof, or a confirmed payment, has the same TrxID (D25). */
  duplicateFlag: 'DUPLICATE_PAYMENT' | 'DUPLICATE_PENDING' | null;
  billAlreadyPaid: boolean;
  bills: {
    studentFeeId: string;
    studentId: string;
    studentName: string;
    amount: string;
    paymentId: string | null;
  }[];
  files: { id: string; contentType: string; sizeBytes: number }[];
  events: {
    fromStatus: PaymentSubmissionStatus | null;
    toStatus: PaymentSubmissionStatus;
    actorUserId: string | null;
    reasonCode: string | null;
    note: string | null;
    createdAt: string;
  }[];
  next_pending_id: string | null;
}

export interface ConfirmProofResult {
  /** `DISCARDED` when the bill was settled elsewhere first: no money moved. */
  outcome: 'SETTLED' | 'DISCARDED';
  paymentIds: string[];
  detail: ProofReviewDetail;
}

export interface ProofReviewFilters {
  source?: PaymentSubmissionSource;
  status?: PaymentSubmissionStatus;
  limit?: number;
  cursor?: string;
}

export interface RejectProofInput {
  reason: PaymentProofRejectReason;
  /** Required when `reason` is `OTHER`. */
  note?: string;
}

export const paymentSubmissionKeys = {
  ...createEntityKeys<ProofReviewFilters, string>('payment-submissions'),
  /** Guardian's own list. */
  portal: (studentId?: string) => ['payment-submissions', 'portal', studentId ?? null] as const,
};

// ---- Guardian portal ----

/** What the school accepts (no credentials). */
export function usePaymentOptions({ enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: ['payment-submissions', 'portal-options'] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<PaymentOptions>('/portal/payment-options', { signal })).data,
    retry: shouldRetryQuery,
  });
}

/** Open bills per linked child, each with its waiting submission (any source) or null. */
export function usePaymentCart({ enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: ['payment-submissions', 'portal-cart'] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<PaymentCart>('/portal/payment-cart', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useMyPaymentProofs(studentId?: string, { enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: paymentSubmissionKeys.portal(studentId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<ProofSubmission[]>('/portal/payment-proofs', {
          params: studentId ? { studentId } : undefined,
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

async function fileFingerprint(f: File): Promise<[string, number, string]> {
  // crypto.subtle is missing outside a secure context (plain http): fall back to name + size + mtime.
  if (!globalThis.crypto?.subtle) return [f.name, f.size, String(f.lastModified)];
  const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return [f.name, f.size, hex];
}

/** Multipart. Rule 25: one `Idempotency-Key` per attempt, never auto-retried. */
export function useSubmitPaymentProof() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ files = [], ...fields }: SubmitProofInput) => {
      const form = new FormData();
      for (const id of fields.billIds) form.append('billIds', id);
      form.append('method', fields.method);
      form.append('amount', String(fields.amount));
      form.append('paidOn', fields.paidOn);
      if (fields.reference) form.append('reference', fields.reference);
      for (const file of files) form.append('files', file);
      // Name + size + SHA-256 of the bytes: a different file never reuses an earlier key.
      const body = { ...fields, files: await Promise.all(files.map(fileFingerprint)) };
      return (
        await apiClient.post<ProofSubmission>('/portal/payment-proofs', form, {
          headers: { 'Idempotency-Key': keyFor(body) },
        })
      ).data;
    },
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: paymentSubmissionKeys.all });
      // The bill now shows "waiting" in the portal's fee lists.
      void queryClient.invalidateQueries({ queryKey: ['fees'] });
    },
    retry: false,
  });
}

export function useWithdrawPaymentProof() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await apiClient.post<ProofSubmission>(`/portal/payment-proofs/${id}/withdraw`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ id }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: paymentSubmissionKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['fees'] });
    },
    retry: false,
  });
}

// ---- Staff review ----

export function usePaymentSubmissions(
  filters: ProofReviewFilters = {},
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled,
    queryKey: paymentSubmissionKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ProofReviewList>('/payment-submissions', { params: filters, signal }))
        .data,
    retry: shouldRetryQuery,
  });
}

export function paymentSubmissionQueryOptions(id: string) {
  return queryOptions({
    queryKey: paymentSubmissionKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<ProofReviewDetail>(`/payment-submissions/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function usePaymentSubmission(id: string | undefined) {
  return useQuery({
    ...paymentSubmissionQueryOptions(id ?? ''),
    enabled: id !== undefined && id !== '',
  });
}

/** Decisions change money and the waiting count: refresh every proof query and the fee lists. */
function useRefreshAfterDecision() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: paymentSubmissionKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['fees'] });
  };
}

/** Rule 25: a double click replays the first answer (same key per proof). */
export function useConfirmPaymentProof() {
  const refresh = useRefreshAfterDecision();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await apiClient.post<ConfirmProofResult>(`/payment-submissions/${id}/confirm`, undefined, {
          headers: { 'Idempotency-Key': keyFor({ id, action: 'confirm' }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      refresh();
    },
    retry: false,
  });
}

export function useRejectPaymentProof() {
  const refresh = useRefreshAfterDecision();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ id, ...input }: RejectProofInput & { id: string }) =>
      (
        await apiClient.post<ProofReviewDetail>(`/payment-submissions/${id}/reject`, input, {
          headers: { 'Idempotency-Key': keyFor({ id, ...input }) },
        })
      ).data,
    onSuccess: () => {
      rotate();
      refresh();
    },
    retry: false,
  });
}

export function useReopenPaymentProof() {
  const refresh = useRefreshAfterDecision();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) =>
      (
        await apiClient.post<ProofReviewDetail>(
          `/payment-submissions/${id}/reopen`,
          { note },
          { headers: { 'Idempotency-Key': keyFor({ id, note }) } },
        )
      ).data,
    onSuccess: () => {
      rotate();
      refresh();
    },
    retry: false,
  });
}
