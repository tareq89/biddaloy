import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/** `WalletController.getWallet`'s 200 body is a union — staff get the full
 * `StudentWalletResponseDto` shape, a PARENT/STUDENT get the reduced
 * `FamilyStudentWalletResponseDto` (no `id`/`wallet_id`/`payment_id`/
 * `student_fee_id`/`reversal_of_id`/`created_by_user_id` on each
 * transaction). `[16.4.5]` only reads fields both shapes share
 * (`amount`, `kind`, `note`, `created_at`), so callers don't need to
 * narrow — same reasoning `payments.ts`'s `usePaymentsByStudent` gives for
 * its own `Payment | FamilyPayment` union. */
export type StudentWallet = components['schemas']['StudentWalletResponseDto'];
export type FamilyStudentWallet = components['schemas']['FamilyStudentWalletResponseDto'];
export type WalletTransaction = components['schemas']['WalletTransaction'];
export type FamilyWalletTransaction = components['schemas']['FamilyWalletTransactionDto'];

export const walletKeys = createEntityKeys<{ studentId: string; page?: number }>('wallet');

/** [16.4.5]'s wallet balance chip (dues.tsx) and Wallet section
 * (fees-tab.tsx) — both back onto `GET students/:id/wallet`
 * (`server/src/modules/fees/wallet.controller.ts`), which is read-only:
 * writes only ever happen as a side effect of another operation (checkout,
 * fee generation, reversal), never through a route of its own — so this
 * file has no mutation hook. */
export function useStudentWallet(studentId: string | undefined, page = 1) {
  return useQuery(
    queryOptions({
      queryKey: walletKeys.list({ studentId: studentId ?? '', page }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<StudentWallet | FamilyStudentWallet>(
          `/students/${studentId}/wallet`,
          { params: { page }, signal },
        );
        return res.data;
      },
      // Same reasoning as `useStudentFeeSummary`'s `enabled` — a caller
      // (e.g. a dialog mid-flow) may not know the student yet.
      enabled: studentId !== undefined,
      // The dues queue's `WalletChip` fires one of these per visible row
      // (no batched wallet-balance endpoint exists), and the endpoint
      // itself pulls up to 50 ledger rows alongside the balance — a short
      // staleTime keeps a page of chips from refetching (and re-fetching
      // their discarded ledgers) on every remount/refocus.
      staleTime: 30_000,
      retry: shouldRetryQuery,
    }),
  );
}
