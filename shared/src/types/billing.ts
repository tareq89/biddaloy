import type { PlatformPaymentMethod, SeatOrderStatus } from '../enums/billing';

export interface SeatOrderDto {
  id: string;
  school_id: string;
  seats: number;
  months: number;
  unit_price_paisa: number;
  amount_paisa: number;
  /** ISO dates (YYYY-MM-DD). */
  period_start: string;
  period_end: string;
  status: SeatOrderStatus;
  method: PlatformPaymentMethod | null;
  /** `SMR-YYYY-NNNNNN` once paid; null for unpaid orders and grants. */
  receipt_number: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface BillingSummary {
  free_until: string;
  seats_bought: number;
  seats_used: number;
  /** Latest paid period end, or null if never bought. */
  paid_until: string | null;
  /** End of the 7-day read-only window when the school is over its seats; else null (D9). */
  read_only_until: string | null;
  orders: SeatOrderDto[];
}

/** Platform list filters (Epic 49 W4): expiring within 14 days, seats used up, paused as idle. */
export const SCHOOL_BILLING_FILTERS = ['expiring', 'exhausted', 'idle'] as const;
export type SchoolBillingFilter = (typeof SCHOOL_BILLING_FILTERS)[number];

/** One school's row in the platform subscriptions list. */
export interface PlatformSchoolBilling {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  deleted: boolean;
  seats_entitled: number;
  seats_used: number;
  /** Last day covered by a paid order, ISO date, or null if never bought. */
  paid_until: string | null;
  pending_orders: number;
}

/** A page of the platform list; `total` is the match count before paging. */
export interface PlatformSchoolBillingPage {
  items: PlatformSchoolBilling[];
  total: number;
}

export interface PlatformSchoolBillingDetail extends PlatformSchoolBilling {
  orders: SeatOrderDto[];
}
