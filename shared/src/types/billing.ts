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
  paid_at: string | null;
  created_at: string;
}

export interface BillingSummary {
  free_until: string;
  seats_bought: number;
  seats_used: number;
  /** Latest paid period end, or null if never bought. */
  paid_until: string | null;
  orders: SeatOrderDto[];
}
