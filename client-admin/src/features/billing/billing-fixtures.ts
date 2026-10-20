import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import type { BillingSummary, SeatOrderDto } from '@biddaloy/ui/hooks';

/** Shared by the view tests and the stories. */
const order = (over: Partial<SeatOrderDto> = {}): SeatOrderDto => ({
  id: '6b0c6f5e-0000-4000-8000-000000000001',
  school_id: 'school-1',
  seats: 300,
  months: 3,
  unit_price_paisa: 1000,
  amount_paisa: 900_000,
  period_start: '2027-01-02',
  period_end: '2027-04-02',
  status: SeatOrderStatus.PENDING,
  method: null,
  paid_at: null,
  created_at: '2026-10-15T06:00:00.000Z',
  ...over,
});

export const summaryEmpty: BillingSummary = {
  free_until: '2026-12-31T18:00:00.000Z',
  seats_bought: 0,
  seats_used: 240,
  paid_until: null,
  read_only_until: null,
  orders: [],
};

export const summaryFree: BillingSummary = { ...summaryEmpty, orders: [order()] };

export const summaryExpiring: BillingSummary = {
  free_until: '2026-12-31T18:00:00.000Z',
  seats_bought: 300,
  seats_used: 280,
  paid_until: '2027-03-20',
  read_only_until: null,
  orders: [order({ status: SeatOrderStatus.PAID, method: PlatformPaymentMethod.BKASH })],
};
