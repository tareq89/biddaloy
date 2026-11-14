import { http, HttpResponse } from 'msw';

import { apiErrorBody } from '../support';

// Epic 49: `GET /billing/summary`. The admin layout reads `read_only_until` on every page, so
// the happy path is "not over the seat limit": a bare school with nothing bought.
const summary = http.get('/api/v1/billing/summary', () =>
  HttpResponse.json({
    free_until: '2026-12-31T18:00:00.000Z',
    seats_bought: 0,
    seats_used: 0,
    unit_price_paisa: 5000,
    paid_until: null,
    read_only_until: null,
    orders: [],
  }),
);

/**
 * [100.4.01] `POST /billing/orders/preview`. The coupon typed picks the answer:
 * `HALF` takes half off, `FREE` makes the total zero, anything else is the one fixed 400 sentence.
 * No code: the list price.
 */
const preview = http.post('/api/v1/billing/orders/preview', async ({ request }) => {
  const { seats, months, coupon_code } = (await request.json()) as {
    seats: number;
    months: number;
    coupon_code?: string;
  };
  const unit = 5000;
  const list = seats * months * unit;
  let discount = 0;
  if (coupon_code === 'HALF') discount = list / 2;
  else if (coupon_code === 'FREE') discount = list;
  else if (coupon_code) {
    return HttpResponse.json(
      apiErrorBody(400, 'This coupon cannot be used.', '/api/v1/billing/orders/preview'),
      { status: 400 },
    );
  }
  const total = list - discount;
  return HttpResponse.json({
    listAmountPaisa: list,
    discountPaisa: discount,
    totalPaisa: total,
    free: total === 0,
    unit_price_paisa: unit,
    status: total === 0 ? 'PAID' : 'PENDING',
  });
});

export const billingDefaultHandlers = [summary, preview];
