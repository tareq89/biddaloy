import type { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/** `FeeController.getDues`/`getFlaggedDues`'s untyped 200 body — same
 * documentation gap `payments.ts`'s `StudentFeeSummary`, hand-typed
 * against `fee-dues.service.ts`'s `DueEntry` (lines 12-30 there), which
 * [16.4.5] widened to the bill-shaped per-fee-line data this ticket's UI
 * needs — `fee_name`/`fee_type`/`period_start`/`period_type`/`occurrence`/
 * `is_late_fee`/`standing_discount_amount`/`one_off_discount_amount` are
 * new here; `discount_amount` stays (server keeps it as the sum of the
 * two split-out fields, for callers that don't care about the split).
 * `guardians` is only present on the flagged response (it feeds the
 * bulk-reminder flow's recipient preview there) — optional here rather
 * than a second parallel type, since nothing in [8.10.4]'s dues queue
 * reads it. */
export interface FeeDueEntry {
  student_fee_id: string;
  fee_structure_id: string;
  fee_name: string;
  fee_type: FeeType;
  month: number;
  year: number;
  period_start: string;
  period_type: PeriodType;
  /** Which bill this is within its recurring series — the "(2)" suffix
   * next to a fee name when the same fee has more than one open
   * occurrence. */
  occurrence: number;
  /** This bill IS a late fee (`late_fee_for_student_fee_id IS NOT NULL`
   * server-side) — drives the late-fee badge on its row. */
  is_late_fee: boolean;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
  balance: number;
  status: FeeStatus;
  due_date: string | null;
  reminder_threshold_date: string | null;
}

export interface FeeDueRow {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
  dues: FeeDueEntry[];
  guardians?: Array<{
    id: string;
    full_name: string;
    relationship: string;
    phone: string | null;
    email: string | null;
    alternate_phone: string | null;
    preferred_communication: string;
    is_primary_contact: boolean;
  }>;
}

export interface PaginatedFeeDues {
  data: FeeDueRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type FeeDuesSortBy = 'due_amount' | 'name' | 'class';
export type SortOrder = 'ASC' | 'DESC';

/** The full filter set `GET /fees/dues` accepts. `GET /fees/dues/flagged`
 * accepts only `class_id`/`section_id`/`page`/`limit` — the global
 * `ValidationPipe`'s `forbidNonWhitelisted: true` 400s on anything else,
 * so `useFeeDues` strips the rest before calling it. */
export interface FeeDuesFilters {
  class_id?: string;
  section_id?: string;
  month?: number;
  year?: number;
  status?: FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID;
  /** Narrows to students with at least one open bill against a fee
   * structure of this type — `QueryFeeDuesDto.fee_type`'s own comment.
   * Not accepted by `GET /fees/dues/flagged` — `FLAGGED_FIELDS` below
   * strips it before that request goes out, same as `search`. */
  fee_type?: FeeType;
  /** Matches student full_name, registration_number, or roll_number — see
   * `QueryFeeDuesDto.search`'s own comment. Not accepted by `GET
   * /fees/dues/flagged`, same as every field below `class_id`/`section_id`
   * — `FLAGGED_FIELDS` below strips it before that request goes out. */
  search?: string;
  sort_by?: FeeDuesSortBy;
  sort_order?: SortOrder;
  page?: number;
  limit?: number;
}

export const feeDuesKeys = createEntityKeys<FeeDuesFilters & { flagged?: boolean }>('fee-dues');

const FLAGGED_FIELDS = ['class_id', 'section_id', 'page', 'limit'] as const;

function toFlaggedParams(
  filters: FeeDuesFilters,
): Pick<FeeDuesFilters, 'class_id' | 'section_id' | 'page' | 'limit'> {
  const params: Record<string, unknown> = {};
  for (const key of FLAGGED_FIELDS) {
    if (filters[key] !== undefined) params[key] = filters[key];
  }
  return params;
}

/** One hook, two endpoints — [8.10.4]'s Flagged/Overdue toggle switches
 * which one is called while the caller's `filters` object (and thus the
 * URL search params driving it) stays untouched, satisfying the AC that
 * every other filter survives the switch. */
export function feeDuesQueryOptions(filters: FeeDuesFilters = {}, flagged = false) {
  return queryOptions({
    queryKey: feeDuesKeys.list({ ...filters, flagged }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedFeeDues>(
        flagged ? '/fees/dues/flagged' : '/fees/dues',
        { params: flagged ? toFlaggedParams(filters) : filters, signal },
      );
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

export function useFeeDues(filters: FeeDuesFilters = {}, flagged = false) {
  return useQuery(feeDuesQueryOptions(filters, flagged));
}
